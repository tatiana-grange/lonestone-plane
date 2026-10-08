# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone

from plane.db.models import Issue, IssueAssignee, Project, ProjectMember, State, User, WorkspaceMember
from plane.extended.services import issue_bulk_update
from plane.extended.serializers import BulkUpdateValidationError
from plane.extended.services.issue_bulk_update import (
    BulkPropertyHandler,
    Change,
    bulk_update_issues,
)

SERVICE = "plane.extended.services.issue_bulk_update"


def _make_state(project, name, group="started", sequence=2, default=False):
    return State.objects.create(
        name=name,
        color="#000000",
        project=project,
        workspace=project.workspace,
        sequence=sequence,
        group=group,
        default=default,
        created_by=project.created_by,
    )


def _make_project(workspace, owner, name, identifier):
    project = Project.objects.create(name=name, identifier=identifier, workspace=workspace, created_by=owner)
    ProjectMember.objects.create(project=project, member=owner, workspace=workspace, role=20)
    _make_state(project, "Backlog", group="backlog", sequence=1, default=True)
    return project


def _make_issue(project, name, **fields):
    issue = Issue(name=name, project=project, workspace=project.workspace, **fields)
    issue.save(created_by_id=project.created_by_id)
    return issue


@pytest.fixture
def project(db, workspace, create_user):
    return _make_project(workspace, create_user, "Bulk Project", "BLK")


@pytest.fixture
def other_project(db, workspace, create_user):
    return _make_project(workspace, create_user, "Other Project", "OTH")


@pytest.fixture
def tasks():
    with patch(f"{SERVICE}.issue_activity") as issue_activity, patch(f"{SERVICE}.model_activity") as model_activity:
        yield issue_activity, model_activity


class _NameHandler(BulkPropertyHandler):
    """Test-only handler that writes ``Issue.name``."""

    issue_fields = ("name",)

    def validate(self, value, *, project_id, slug):
        return value

    def plan(self, issue, value, *, properties):
        if issue.name == value:
            return None
        return Change(issue=issue, requested={"name": value}, current={"name": issue.name})

    def apply(self, changes, *, actor):
        for change in changes:
            change.issue.name = change.requested["name"]


class _ExplodingHandler(_NameHandler):
    def apply(self, changes, *, actor):
        raise RuntimeError("boom")


def _run(workspace, project, issue_ids, properties, actor):
    return bulk_update_issues(
        slug=workspace.slug,
        project_id=project.id,
        issue_ids=issue_ids,
        properties=properties,
        actor=actor,
        origin="http://testserver",
    )


@pytest.mark.unit
@pytest.mark.django_db
class TestBulkUpdateService:
    @pytest.mark.parametrize("kind", ["foreign", "archived", "draft"])
    def test_inactive_issue_rejects_the_whole_request(
        self, workspace, project, other_project, create_user, monkeypatch, tasks, kind
    ):
        monkeypatch.setitem(issue_bulk_update.PROPERTY_HANDLERS, "state_id", _NameHandler())
        inactive = {
            "foreign": lambda: _make_issue(other_project, "Inactive"),
            "archived": lambda: _make_issue(project, "Inactive", archived_at=timezone.now()),
            "draft": lambda: _make_issue(project, "Inactive", is_draft=True),
        }[kind]()
        active = _make_issue(project, "Active")

        with pytest.raises(BulkUpdateValidationError) as error:
            _run(workspace, project, [str(inactive.id), str(active.id)], {"state_id": "Renamed"}, create_user)

        assert error.value.code == "not_found"
        active.refresh_from_db()
        inactive.refresh_from_db()
        assert (active.name, inactive.name) == ("Active", "Inactive")

    def test_duplicates_are_processed_once(
        self, workspace, project, create_user, monkeypatch, tasks, django_capture_on_commit_callbacks
    ):
        monkeypatch.setitem(issue_bulk_update.PROPERTY_HANDLERS, "state_id", _NameHandler())
        issue = _make_issue(project, "Original")

        with django_capture_on_commit_callbacks(execute=True):
            result = _run(workspace, project, [str(issue.id), str(issue.id)], {"state_id": "Renamed"}, create_user)

        assert result == {"updated_issue_ids": [str(issue.id)], "unchanged_issue_ids": []}
        issue_activity, model_activity = tasks
        assert issue_activity.delay.call_count == 1
        assert model_activity.delay.call_count == 1
        issue.refresh_from_db()
        assert issue.name == "Renamed"
        assert issue.updated_by_id == create_user.id

    def test_no_activity_when_transaction_rolls_back(
        self, workspace, project, create_user, monkeypatch, tasks, django_capture_on_commit_callbacks
    ):
        monkeypatch.setitem(issue_bulk_update.PROPERTY_HANDLERS, "state_id", _ExplodingHandler())
        issue = _make_issue(project, "Original")

        with django_capture_on_commit_callbacks(execute=True) as callbacks:
            with pytest.raises(RuntimeError):
                _run(workspace, project, [str(issue.id)], {"state_id": "Renamed"}, create_user)

        assert callbacks == []
        issue_activity, model_activity = tasks
        issue_activity.delay.assert_not_called()
        model_activity.delay.assert_not_called()
        issue.refresh_from_db()
        assert issue.name == "Original"


@pytest.mark.unit
@pytest.mark.django_db
class TestStateHandler:
    def test_state_of_other_project_is_rejected(self, workspace, project, other_project, create_user):
        foreign_state = _make_state(other_project, "Foreign")
        issue = _make_issue(project, "Work item")
        with pytest.raises(BulkUpdateValidationError) as error:
            _run(workspace, project, [str(issue.id)], {"state_id": str(foreign_state.id)}, create_user)
        assert error.value.code == "state_not_in_project"

    def test_updates_state_audit_fields_and_completed_at(self, workspace, project, create_user, tasks):
        done = _make_state(project, "Done", group="completed", sequence=3)
        issue = _make_issue(project, "Work item")
        before = Issue.objects.get(pk=issue.pk).updated_at

        result = _run(workspace, project, [str(issue.id)], {"state_id": str(done.id)}, create_user)

        assert result["updated_issue_ids"] == [str(issue.id)]
        issue.refresh_from_db()
        assert issue.state_id == done.id
        assert issue.updated_by_id == create_user.id
        assert issue.updated_at > before
        assert issue.completed_at is not None


def _make_member(workspace, project, prefix):
    unique_id = uuid4().hex[:8]
    user = User.objects.create(email=f"{prefix}-{unique_id}@plane.so", username=f"{prefix}_{unique_id}")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=15)
    return user


@pytest.mark.unit
@pytest.mark.django_db
class TestAssigneesHandler:
    def test_existing_links_are_kept_and_only_missing_ones_created(self, workspace, project, create_user, tasks):
        alice = _make_member(workspace, project, "alice")
        bob = _make_member(workspace, project, "bob")
        issue = _make_issue(project, "Work item")
        existing = IssueAssignee.objects.create(
            issue=issue, assignee=bob, project=project, workspace=workspace, created_by=create_user
        )

        result = _run(workspace, project, [str(issue.id)], {"assignee_ids": [str(alice.id), str(bob.id)]}, create_user)

        assert result["updated_issue_ids"] == [str(issue.id)]
        links = {link.assignee_id: link.id for link in IssueAssignee.objects.filter(issue=issue)}
        assert set(links) == {alice.id, bob.id}
        assert links[bob.id] == existing.id
        created = IssueAssignee.objects.get(issue=issue, assignee=alice)
        assert created.created_by_id == create_user.id
        assert created.project_id == project.id


@pytest.mark.unit
@pytest.mark.django_db
class TestDateMerge:
    def test_start_after_stored_target_fails(self, workspace, project, create_user, tasks):
        issue = _make_issue(project, "Work item", target_date=date(2026, 10, 10))
        with pytest.raises(BulkUpdateValidationError) as error:
            _run(workspace, project, [str(issue.id)], {"start_date": "2026-10-20"}, create_user)
        assert error.value.code == "invalid_date_range"

    def test_target_before_stored_start_fails(self, workspace, project, create_user, tasks):
        issue = _make_issue(project, "Work item", start_date=date(2026, 10, 20))
        with pytest.raises(BulkUpdateValidationError) as error:
            _run(workspace, project, [str(issue.id)], {"target_date": "2026-10-10"}, create_user)
        assert error.value.code == "invalid_date_range"

    def test_clearing_a_date_is_always_valid(self, workspace, project, create_user, tasks):
        issue = _make_issue(project, "Work item", start_date=date(2026, 10, 20), target_date=date(2026, 10, 25))
        result = _run(workspace, project, [str(issue.id)], {"target_date": None}, create_user)
        assert result["updated_issue_ids"] == [str(issue.id)]
        issue.refresh_from_db()
        assert issue.target_date is None
        assert issue.start_date == date(2026, 10, 20)

    def test_both_dates_in_one_request_are_merged_together(self, workspace, project, create_user, tasks):
        issue = _make_issue(project, "Work item", start_date=date(2026, 10, 1), target_date=date(2026, 10, 5))
        result = _run(
            workspace,
            project,
            [str(issue.id)],
            {"start_date": "2026-10-20", "target_date": "2026-10-25"},
            create_user,
        )
        assert result["updated_issue_ids"] == [str(issue.id)]


@pytest.mark.unit
@pytest.mark.django_db
class TestRemoveLinksHandler:
    def test_one_soft_delete_query_for_the_whole_batch(self, workspace, project, create_user, tasks):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from plane.db.models import IssueLabel, Label

        label = Label.objects.create(name="front", project=project, workspace=workspace)
        issues = [_make_issue(project, f"Work item {index}") for index in range(3)]
        for issue in issues:
            IssueLabel.objects.create(issue=issue, label=label, project=project, workspace=workspace)

        with CaptureQueriesContext(connection) as queries:
            result = _run(
                workspace, project, [str(i.id) for i in issues], {"remove_label_ids": [str(label.id)]}, create_user
            )

        assert len(result["updated_issue_ids"]) == 3
        soft_deletes = [q["sql"] for q in queries.captured_queries if q["sql"].startswith('UPDATE "issue_labels"')]
        assert len(soft_deletes) == 1
        assert not IssueLabel.objects.filter(label=label).exists()
