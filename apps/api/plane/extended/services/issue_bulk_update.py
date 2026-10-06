# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Bulk update of work item properties within a single project.

Each issue is processed independently: it ends up either updated, unchanged or
failed (per-issue reason). Writes happen in one transaction; activities and
webhooks are emitted per updated issue once the transaction is committed.
"""

import json
from dataclasses import dataclass, field
from datetime import date
from typing import Any
from uuid import UUID

from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db import transaction
from django.db.models import Q, UUIDField, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from plane.bgtasks.issue_activities_task import issue_activity
from plane.bgtasks.webhook_task import model_activity
from plane.db.models import Issue, IssueAssignee, IssueLabel, Label, Module, ModuleIssue, ProjectMember, State
from plane.db.models.state import StateGroup
from plane.extended.serializers.issue_bulk_update import BulkUpdateValidationError


PRIORITIES = ("urgent", "high", "medium", "low", "none")


@dataclass
class Change:
    """A planned modification of one property on one issue.

    ``requested`` / ``current`` hold JSON-friendly values used for the activity
    log and the webhook diff. ``payload`` is handler-specific (e.g. added ids).
    """

    issue: Issue
    requested: dict
    current: dict
    payload: Any = None
    # extra data some handlers need for their activities (e.g. module names)
    meta: dict = field(default_factory=dict)


@dataclass
class Failure:
    code: str


class BulkPropertyHandler:
    """Base class for one supported property.

    ``issue_fields`` lists the ``Issue`` columns written by ``apply``; the service
    persists them with ``updated_at`` / ``updated_by_id`` in a single bulk update.
    """

    issue_fields: tuple = ()

    def validate(self, value, *, project_id, slug):
        raise NotImplementedError

    def plan(self, issue, value, *, properties) -> Change | Failure | None:
        raise NotImplementedError

    def apply(self, changes, *, actor) -> None:
        raise NotImplementedError

    def activities(self, change) -> list[dict]:
        return [
            {
                "type": "issue.activity.updated",
                "requested_data": json.dumps(change.requested),
                "current_instance": json.dumps(change.current),
            }
        ]


def _parse_uuid(value) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise BulkUpdateValidationError("invalid_value", f"Invalid UUID: {value}")


class StateHandler(BulkPropertyHandler):
    """Replaces the state. ``completed_at`` follows the state group, like ``Issue.save``."""

    issue_fields = ("state_id", "completed_at")

    def validate(self, value, *, project_id, slug):
        state = State.objects.filter(pk=_parse_uuid(value), project_id=project_id, workspace__slug=slug).first()
        if state is None:
            raise BulkUpdateValidationError("state_not_in_project", "The state does not belong to the project")
        return state

    def plan(self, issue, value, *, properties):
        if issue.state_id == value.id:
            return None
        return Change(
            issue=issue,
            requested={"state_id": str(value.id)},
            current={"state_id": str(issue.state_id) if issue.state_id else None},
            payload=value,
        )

    def apply(self, changes, *, actor):
        now = timezone.now()
        for change in changes:
            state = change.payload
            change.issue.state_id = state.id
            change.issue.completed_at = now if state.group == StateGroup.COMPLETED.value else None


class _ReplaceFieldHandler(BulkPropertyHandler):
    """Replaces a scalar ``Issue`` field; the activity logs the old and new values."""

    field: str

    def plan(self, issue, value, *, properties):
        current = getattr(issue, self.field)
        if current == value:
            return None
        return Change(
            issue=issue,
            requested={self.field: self._serialize(value)},
            current={self.field: self._serialize(current)},
            payload=value,
        )

    def apply(self, changes, *, actor):
        for change in changes:
            setattr(change.issue, self.field, change.payload)

    @staticmethod
    def _serialize(value):
        return value


class PriorityHandler(_ReplaceFieldHandler):
    field = "priority"
    issue_fields = ("priority",)

    def validate(self, value, *, project_id, slug):
        if value not in PRIORITIES:
            raise BulkUpdateValidationError("invalid_value", f"Priority must be one of {', '.join(PRIORITIES)}")
        return value


class _DateHandler(_ReplaceFieldHandler):
    """Replaces a date (``None`` clears it).

    The new value is checked against the other date after merging with the stored
    value, or with the other date of the same request when both are sent.
    """

    other_field: str

    def validate(self, value, *, project_id, slug):
        if value is None:
            return None
        if not isinstance(value, str):
            raise BulkUpdateValidationError("invalid_value", "Dates must use the YYYY-MM-DD format")
        try:
            return date.fromisoformat(value)
        except ValueError:
            raise BulkUpdateValidationError("invalid_value", "Dates must use the YYYY-MM-DD format")

    def plan(self, issue, value, *, properties):
        other = properties[self.other_field] if self.other_field in properties else getattr(issue, self.other_field)
        start, target = (value, other) if self.field == "start_date" else (other, value)
        if start is not None and target is not None and start > target:
            return Failure("invalid_date_range")
        return super().plan(issue, value, properties=properties)

    @staticmethod
    def _serialize(value):
        return value.isoformat() if value is not None else None


class StartDateHandler(_DateHandler):
    field = "start_date"
    other_field = "target_date"
    issue_fields = ("start_date",)


class TargetDateHandler(_DateHandler):
    field = "target_date"
    other_field = "start_date"
    issue_fields = ("target_date",)


def _parse_uuid_list(value) -> list[str]:
    if not isinstance(value, list) or not value:
        raise BulkUpdateValidationError("invalid_value", "Expected a non-empty list of UUIDs")
    return list(dict.fromkeys(_parse_uuid(item) for item in value))


class _AddLinksHandler(BulkPropertyHandler):
    """Adds many-to-many links (never removes any).

    The activity carries the full resulting set, since ``issue_activity`` diffs
    complete sets: sending only the added ids would log the others as removed.
    """

    key: str
    link_model: type
    link_field: str

    def plan(self, issue, value, *, properties):
        old = [str(link_id) for link_id in getattr(issue, self.key)]
        added = [link_id for link_id in value if link_id not in old]
        if not added:
            return None
        return Change(
            issue=issue,
            requested={self.key: sorted({*old, *added})},
            current={self.key: sorted(old)},
            payload=added,
        )

    def apply(self, changes, *, actor):
        self.link_model.objects.bulk_create(
            [
                self.link_model(
                    issue=change.issue,
                    project_id=change.issue.project_id,
                    workspace_id=change.issue.workspace_id,
                    created_by_id=actor.id,
                    updated_by_id=actor.id,
                    **{self.link_field: link_id},
                )
                for change in changes
                for link_id in change.payload
            ],
            ignore_conflicts=True,
            batch_size=500,
        )


class _RemoveLinksHandler(BulkPropertyHandler):
    """Removes many-to-many links (soft delete, like Plane's own removals).

    Values are not checked for eligibility: removing a value a work item does not have is a
    no-op, and only links of the URL project's work items are touched. The activity carries the
    full remaining set, so the history shows one "removed" entry per value.
    """

    key: str
    link_model: type
    link_field: str

    def validate(self, value, *, project_id, slug):
        return _parse_uuid_list(value)

    def plan(self, issue, value, *, properties):
        old = [str(link_id) for link_id in getattr(issue, self.key)]
        removed = [link_id for link_id in value if link_id in old]
        if not removed:
            return None
        return Change(
            issue=issue,
            requested={self.key: sorted(set(old) - set(removed))},
            current={self.key: sorted(old)},
            payload=removed,
        )

    def apply(self, changes, *, actor):
        # the requested values are the same for every work item: one query for the whole batch
        values = {link_id for change in changes for link_id in change.payload}
        self.link_model.objects.filter(
            issue_id__in=[change.issue.id for change in changes],
            **{f"{self.link_field}__in": values},
        ).delete()


class AssigneesHandler(_AddLinksHandler):
    key = "assignee_ids"
    link_model = IssueAssignee
    link_field = "assignee_id"

    def validate(self, value, *, project_id, slug):
        user_ids = _parse_uuid_list(value)
        eligible = {
            str(member_id)
            for member_id in ProjectMember.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                member_id__in=user_ids,
                is_active=True,
                role__gte=15,
            ).values_list("member_id", flat=True)
        }
        if len(eligible) != len(user_ids):
            raise BulkUpdateValidationError(
                "assignee_not_eligible", "Assignees must be active project members with at least the member role"
            )
        return user_ids


class RemoveAssigneesHandler(_RemoveLinksHandler):
    key = "assignee_ids"
    link_model = IssueAssignee
    link_field = "assignee_id"


class RemoveLabelsHandler(_RemoveLinksHandler):
    key = "label_ids"
    link_model = IssueLabel
    link_field = "label_id"


@dataclass
class _ModuleRemoval:
    ids: list
    names: dict


class RemoveModulesHandler(_RemoveLinksHandler):
    """Removes work items from modules; logged like Plane's module removal: one activity per module."""

    key = "module_ids"
    link_model = ModuleIssue
    link_field = "module_id"

    def validate(self, value, *, project_id, slug):
        module_ids = super().validate(value, project_id=project_id, slug=slug)
        names = {
            str(module_id): name
            for module_id, name in Module.objects.filter(pk__in=module_ids, project_id=project_id).values_list(
                "id", "name"
            )
        }
        return _ModuleRemoval(ids=module_ids, names=names)

    def plan(self, issue, value, *, properties):
        change = super().plan(issue, value.ids, properties=properties)
        if change is not None:
            change.meta["module_names"] = value.names
        return change

    def activities(self, change):
        return [
            {
                "type": "module.activity.deleted",
                "requested_data": json.dumps({"module_id": module_id}),
                "current_instance": json.dumps({"module_name": change.meta["module_names"].get(module_id)}),
            }
            for module_id in change.payload
        ]


class LabelsHandler(_AddLinksHandler):
    key = "label_ids"
    link_model = IssueLabel
    link_field = "label_id"

    def validate(self, value, *, project_id, slug):
        label_ids = _parse_uuid_list(value)
        found = Label.objects.filter(pk__in=label_ids, project_id=project_id, workspace__slug=slug).count()
        if found != len(label_ids):
            raise BulkUpdateValidationError("label_not_in_project", "Labels must belong to the project")
        return label_ids


class ModulesHandler(_AddLinksHandler):
    """Adds modules; logged like ``create_module_issues``: one activity per new link."""

    key = "module_ids"
    link_model = ModuleIssue
    link_field = "module_id"

    def validate(self, value, *, project_id, slug):
        module_ids = _parse_uuid_list(value)
        found = Module.objects.filter(
            pk__in=module_ids, project_id=project_id, workspace__slug=slug, archived_at__isnull=True
        ).count()
        if found != len(module_ids):
            raise BulkUpdateValidationError(
                "module_not_in_project", "Modules must belong to the project and not be archived"
            )
        return module_ids

    def activities(self, change):
        return [
            {
                "type": "module.activity.created",
                "requested_data": json.dumps({"module_id": module_id}),
                "current_instance": None,
            }
            for module_id in change.payload
        ]


PROPERTY_HANDLERS: dict[str, BulkPropertyHandler] = {
    "state_id": StateHandler(),
    "priority": PriorityHandler(),
    "start_date": StartDateHandler(),
    "target_date": TargetDateHandler(),
    "assignee_ids": AssigneesHandler(),
    "label_ids": LabelsHandler(),
    "module_ids": ModulesHandler(),
    "remove_assignee_ids": RemoveAssigneesHandler(),
    "remove_label_ids": RemoveLabelsHandler(),
    "remove_module_ids": RemoveModulesHandler(),
}


def _issue_queryset(*, slug, project_id, issue_ids):
    return Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, pk__in=issue_ids).annotate(
        label_ids=Coalesce(
            ArrayAgg(
                "labels__id",
                distinct=True,
                filter=Q(~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True)),
            ),
            Value([], output_field=ArrayField(UUIDField())),
        ),
        assignee_ids=Coalesce(
            ArrayAgg(
                "assignees__id",
                distinct=True,
                filter=Q(
                    ~Q(assignees__id__isnull=True)
                    & Q(assignees__member_project__is_active=True)
                    & Q(issue_assignee__deleted_at__isnull=True)
                ),
            ),
            Value([], output_field=ArrayField(UUIDField())),
        ),
        module_ids=Coalesce(
            ArrayAgg(
                "issue_module__module_id",
                distinct=True,
                filter=Q(
                    ~Q(issue_module__module_id__isnull=True)
                    & Q(issue_module__module__archived_at__isnull=True)
                    & Q(issue_module__deleted_at__isnull=True)
                ),
            ),
            Value([], output_field=ArrayField(UUIDField())),
        ),
    )


def bulk_update_issues(*, slug, project_id, issue_ids, properties, actor, origin) -> dict:
    """Apply ``properties`` to ``issue_ids`` and return the per-issue partition.

    Raises ``BulkUpdateValidationError`` when a value is invalid for the project;
    nothing is written in that case.
    """
    issue_ids = list(dict.fromkeys(str(issue_id) for issue_id in issue_ids))
    handlers = {}
    normalized = {}
    for key, raw_value in properties.items():
        handler = PROPERTY_HANDLERS.get(key)
        if handler is None:
            raise BulkUpdateValidationError("unsupported_property", f"Unsupported property: {key}")
        handlers[key] = handler
        normalized[key] = handler.validate(raw_value, project_id=project_id, slug=slug)

    issues = {str(issue.id): issue for issue in _issue_queryset(slug=slug, project_id=project_id, issue_ids=issue_ids)}

    updated_issue_ids = []
    unchanged_issue_ids = []
    failed = []
    changes_by_issue: dict[str, list[tuple[str, Change]]] = {}

    for issue_id in issue_ids:
        issue = issues.get(issue_id)
        if issue is None:
            failed.append({"issue_id": issue_id, "code": "not_found"})
            continue

        issue_changes = []
        failure = None
        for key, handler in handlers.items():
            outcome = handler.plan(issue, normalized[key], properties=normalized)
            if isinstance(outcome, Failure):
                failure = outcome
                break
            if outcome is not None:
                issue_changes.append((key, outcome))

        if failure is not None:
            failed.append({"issue_id": issue_id, "code": failure.code})
        elif issue_changes:
            updated_issue_ids.append(issue_id)
            changes_by_issue[issue_id] = issue_changes
        else:
            unchanged_issue_ids.append(issue_id)

    if changes_by_issue:
        with transaction.atomic():
            _persist(handlers=handlers, changes_by_issue=changes_by_issue, actor=actor)
            # Registered inside the transaction: discarded if it is rolled back.
            _emit_activities(
                handlers=handlers,
                changes_by_issue=changes_by_issue,
                slug=slug,
                project_id=project_id,
                actor=actor,
                origin=origin,
            )

    return {
        "updated_issue_ids": updated_issue_ids,
        "unchanged_issue_ids": unchanged_issue_ids,
        "failed": failed,
    }


def _persist(*, handlers, changes_by_issue, actor):
    now = timezone.now()
    issue_fields = {"updated_at", "updated_by_id"}
    for key, handler in handlers.items():
        changes = [change for issue_changes in changes_by_issue.values() for k, change in issue_changes if k == key]
        if changes:
            handler.apply(changes, actor=actor)
            issue_fields.update(handler.issue_fields)

    touched = []
    for issue_changes in changes_by_issue.values():
        issue = issue_changes[0][1].issue
        issue.updated_at = now
        issue.updated_by_id = actor.id
        touched.append(issue)
    Issue.objects.bulk_update(touched, sorted(issue_fields), batch_size=500)


def _emit_activities(*, handlers, changes_by_issue, slug, project_id, actor, origin):
    epoch = int(timezone.now().timestamp())
    activity_calls = []
    webhook_calls = []
    for issue_id, issue_changes in changes_by_issue.items():
        requested = {}
        current = {}
        for key, change in issue_changes:
            requested.update(change.requested)
            current.update(change.current)
            for activity in handlers[key].activities(change):
                activity_calls.append({**activity, "issue_id": issue_id})
        webhook_calls.append(
            {"model_id": issue_id, "requested_data": requested, "current_instance": json.dumps(current)}
        )

    def send():
        for activity in activity_calls:
            issue_activity.delay(
                **activity,
                actor_id=str(actor.id),
                project_id=str(project_id),
                epoch=epoch,
                notification=True,
                origin=origin,
            )
        for webhook in webhook_calls:
            model_activity.delay(
                model_name="issue",
                **webhook,
                actor_id=actor.id,
                slug=slug,
                origin=origin,
            )

    transaction.on_commit(send)
