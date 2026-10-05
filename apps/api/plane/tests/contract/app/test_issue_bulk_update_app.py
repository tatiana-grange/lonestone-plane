# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the bulk update work items endpoint (Lonestone extended)."""

import json
from datetime import date
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueLabel,
    Label,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.extended.models import ProjectGuestCollaboration

SERVICE = "plane.extended.services.issue_bulk_update"


def _make_user(prefix):
    unique_id = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{prefix}-{unique_id}@plane.so",
        username=f"{prefix}_{unique_id}",
        first_name=prefix.capitalize(),
        last_name="User",
    )
    user.set_password("test-password")
    user.save()
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


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
    project = Project.objects.create(
        name=name,
        identifier=identifier,
        workspace=workspace,
        created_by=owner,
        guest_view_all_features=True,
        cycle_view=True,
        module_view=True,
    )
    ProjectMember.objects.create(project=project, member=owner, workspace=workspace, role=20)
    _make_state(project, "Backlog", group="backlog", sequence=1, default=True)
    return project


def _url(workspace, project_id):
    return reverse(
        "extended-project-issues-bulk-update",
        kwargs={"slug": workspace.slug, "project_id": project_id},
    )


@pytest.fixture
def project(db, workspace, create_user):
    return _make_project(workspace, create_user, "Client Project", "BULK")


@pytest.fixture
def other_project(db, workspace, create_user):
    return _make_project(workspace, create_user, "Other Project", "OTHR")


@pytest.fixture
def ready_state(project):
    return _make_state(project, "Ready to deploy")


@pytest.fixture
def member(db, workspace, project):
    user = _make_user("member")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=15)
    return user


@pytest.fixture
def member_client(member):
    return _client(member)


@pytest.fixture
def guest(db, workspace, project):
    user = _make_user("guest")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=5)
    ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=5)
    return user


@pytest.fixture
def guest_client(guest):
    return _client(guest)


@pytest.fixture
def outsider(db, workspace):
    user = _make_user("outsider")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


@pytest.fixture
def outsider_client(outsider):
    return _client(outsider)


@pytest.fixture
def issues(db, workspace, project, create_user):
    created = []
    for index in range(3):
        issue = Issue(name=f"Work item {index}", project=project, workspace=workspace)
        issue.save(created_by_id=create_user.id)
        created.append(issue)
    return created


@pytest.fixture
def foreign_issue(db, workspace, other_project, create_user):
    issue = Issue(name="Other project work item", project=other_project, workspace=workspace)
    issue.save(created_by_id=create_user.id)
    return issue


@pytest.fixture
def tasks():
    with (
        patch(f"{SERVICE}.issue_activity") as issue_activity,
        patch(f"{SERVICE}.model_activity") as model_activity,
    ):
        yield issue_activity, model_activity


def _ids(items):
    return [str(item.id) for item in items]


def _assert_partition(data, requested_ids):
    updated = set(data["updated_issue_ids"])
    unchanged = set(data["unchanged_issue_ids"])
    failed = {item["issue_id"] for item in data["failed"]}
    assert not (updated & unchanged)
    assert not (updated & failed)
    assert not (unchanged & failed)
    assert updated | unchanged | failed == set(requested_ids)


@pytest.mark.contract
class TestBulkUpdateEnvelope:
    @pytest.mark.django_db
    def test_unknown_project_returns_404(self, session_client, workspace, issues, ready_state):
        response = session_client.post(
            _url(workspace, uuid4()),
            {"issue_ids": _ids(issues), "properties": {"state_id": str(ready_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.django_db
    def test_non_collaborating_guest_is_forbidden(self, guest_client, workspace, project, issues, ready_state):
        ProjectGuestCollaboration.objects.create(project=project, guest_can_collaborate=False)
        response = guest_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {"state_id": str(ready_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Issue.objects.filter(state=ready_state).exists()

    @pytest.mark.django_db
    def test_workspace_member_outside_project_is_forbidden(
        self, outsider_client, workspace, project, issues, ready_state
    ):
        response = outsider_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {"state_id": str(ready_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Issue.objects.filter(state=ready_state).exists()

    @pytest.mark.django_db
    @pytest.mark.parametrize("payload", [{}, {"issue_ids": []}])
    def test_issue_ids_required(self, session_client, workspace, project, ready_state, payload):
        response = session_client.post(
            _url(workspace, project.id),
            {**payload, "properties": {"state_id": str(ready_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "issue_ids_required"

    @pytest.mark.django_db
    def test_too_many_issues(self, session_client, workspace, project, ready_state):
        response = session_client.post(
            _url(workspace, project.id),
            {"issue_ids": [str(uuid4()) for _ in range(501)], "properties": {"state_id": str(ready_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "too_many_issues"

    @pytest.mark.django_db
    def test_properties_required(self, session_client, workspace, project, issues):
        response = session_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "properties_required"

    @pytest.mark.django_db
    @pytest.mark.parametrize("key", ["cycle_id", "estimate_point", "name"])
    def test_unsupported_property(self, session_client, workspace, project, issues, key):
        response = session_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {key: str(uuid4())}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "unsupported_property"

    @pytest.mark.django_db
    def test_foreign_and_unknown_ids_are_not_found(
        self, session_client, workspace, project, issues, foreign_issue, ready_state, tasks
    ):
        unknown_id = str(uuid4())
        requested = [*_ids(issues), str(foreign_issue.id), unknown_id, str(issues[0].id)]
        response = session_client.post(
            _url(workspace, project.id),
            {"issue_ids": requested, "properties": {"state_id": str(ready_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        failed = {item["issue_id"]: item["code"] for item in response.data["failed"]}
        assert failed == {str(foreign_issue.id): "not_found", unknown_id: "not_found"}
        _assert_partition(response.data, requested)
        foreign_issue.refresh_from_db()
        assert foreign_issue.state_id != ready_state.id


@pytest.mark.contract
class TestBulkUpdateState:
    @pytest.mark.django_db
    def test_admin_updates_state(
        self, session_client, workspace, project, issues, ready_state, tasks, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = session_client.post(
                _url(workspace, project.id),
                {"issue_ids": _ids(issues), "properties": {"state_id": str(ready_state.id)}},
                format="json",
            )
        assert response.status_code == status.HTTP_200_OK
        assert sorted(response.data["updated_issue_ids"]) == sorted(_ids(issues))
        assert Issue.objects.filter(pk__in=_ids(issues), state=ready_state).count() == 3

    @pytest.mark.django_db
    def test_issue_already_in_state_is_unchanged(
        self, session_client, workspace, project, issues, ready_state, tasks, django_capture_on_commit_callbacks
    ):
        Issue.objects.filter(pk=issues[0].pk).update(state=ready_state)
        with django_capture_on_commit_callbacks(execute=True):
            response = session_client.post(
                _url(workspace, project.id),
                {"issue_ids": _ids(issues), "properties": {"state_id": str(ready_state.id)}},
                format="json",
            )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["unchanged_issue_ids"] == [str(issues[0].id)]
        issue_activity, _ = tasks
        assert str(issues[0].id) not in [c.kwargs["issue_id"] for c in issue_activity.delay.call_args_list]

    @pytest.mark.django_db
    def test_state_of_other_project_is_rejected(self, session_client, workspace, project, other_project, issues):
        foreign_state = _make_state(other_project, "Foreign")
        response = session_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {"state_id": str(foreign_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "state_not_in_project"
        assert not Issue.objects.filter(state=foreign_state).exists()

    @pytest.mark.django_db
    def test_member_can_update(self, member_client, workspace, project, issues, ready_state, tasks):
        response = member_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {"state_id": str(ready_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["updated_issue_ids"]) == 3

    @pytest.mark.django_db
    def test_collaborating_guest_can_update(self, guest_client, workspace, project, issues, ready_state, tasks):
        ProjectGuestCollaboration.objects.create(project=project, guest_can_collaborate=True)
        response = guest_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {"state_id": str(ready_state.id)}},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["updated_issue_ids"]) == 3

    @pytest.mark.django_db
    def test_activities_and_webhooks_per_updated_issue(
        self, session_client, workspace, project, issues, ready_state, tasks, django_capture_on_commit_callbacks
    ):
        old_state_id = str(issues[0].state_id)
        with django_capture_on_commit_callbacks(execute=True):
            session_client.post(
                _url(workspace, project.id),
                {"issue_ids": _ids(issues), "properties": {"state_id": str(ready_state.id)}},
                format="json",
            )
        issue_activity, model_activity = tasks
        calls = issue_activity.delay.call_args_list
        assert sorted(c.kwargs["issue_id"] for c in calls) == sorted(_ids(issues))
        epochs = set()
        for call in calls:
            assert call.kwargs["type"] == "issue.activity.updated"
            assert json.loads(call.kwargs["requested_data"]) == {"state_id": str(ready_state.id)}
            assert json.loads(call.kwargs["current_instance"]) == {"state_id": old_state_id}
            assert call.kwargs["notification"] is True
            epochs.add(call.kwargs["epoch"])
        assert len(epochs) == 1
        assert model_activity.delay.call_count == 3
        webhook = model_activity.delay.call_args_list[0].kwargs
        assert webhook["model_name"] == "issue"
        assert webhook["requested_data"] == {"state_id": str(ready_state.id)}


@pytest.fixture
def bob(db, workspace, project):
    user = _make_user("bob")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=15)
    return user


def _assign(issue, user):
    IssueAssignee.objects.create(
        issue=issue, assignee=user, project=issue.project, workspace=issue.workspace, created_by=user
    )


def _assignee_ids(issue):
    return set(IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True))


@pytest.mark.contract
class TestBulkUpdateAssignees:
    @pytest.mark.django_db
    def test_adds_assignee_and_keeps_existing(
        self, session_client, workspace, project, issues, member, bob, tasks, django_capture_on_commit_callbacks
    ):
        _assign(issues[0], bob)
        _assign(issues[1], bob)
        with django_capture_on_commit_callbacks(execute=True):
            response = session_client.post(
                _url(workspace, project.id),
                {"issue_ids": _ids(issues), "properties": {"assignee_ids": [str(member.id)]}},
                format="json",
            )
        assert response.status_code == status.HTTP_200_OK
        assert sorted(response.data["updated_issue_ids"]) == sorted(_ids(issues))
        assert _assignee_ids(issues[0]) == {member.id, bob.id}
        assert _assignee_ids(issues[1]) == {member.id, bob.id}
        assert _assignee_ids(issues[2]) == {member.id}

    @pytest.mark.django_db
    def test_issue_already_assigned_is_unchanged(self, session_client, workspace, project, issues, member, tasks):
        _assign(issues[0], member)
        response = session_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {"assignee_ids": [str(member.id)]}},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["unchanged_issue_ids"] == [str(issues[0].id)]

    @pytest.mark.django_db
    @pytest.mark.parametrize("who", ["guest", "outsider"])
    def test_ineligible_assignee_is_rejected(self, request, session_client, workspace, project, issues, who):
        user = request.getfixturevalue(who)
        response = session_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {"assignee_ids": [str(user.id)]}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "assignee_not_eligible"
        assert not IssueAssignee.objects.filter(assignee=user).exists()

    @pytest.mark.django_db
    def test_empty_assignees_is_invalid(self, session_client, workspace, project, issues):
        response = session_client.post(
            _url(workspace, project.id),
            {"issue_ids": _ids(issues), "properties": {"assignee_ids": []}},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "invalid_value"

    @pytest.mark.django_db
    def test_activity_carries_full_assignee_set(
        self, session_client, workspace, project, issues, member, bob, tasks, django_capture_on_commit_callbacks
    ):
        _assign(issues[0], bob)
        with django_capture_on_commit_callbacks(execute=True):
            session_client.post(
                _url(workspace, project.id),
                {"issue_ids": [str(issues[0].id)], "properties": {"assignee_ids": [str(member.id)]}},
                format="json",
            )
        issue_activity, _ = tasks
        call = issue_activity.delay.call_args.kwargs
        assert call["type"] == "issue.activity.updated"
        assert json.loads(call["requested_data"]) == {"assignee_ids": sorted([str(member.id), str(bob.id)])}
        assert json.loads(call["current_instance"]) == {"assignee_ids": [str(bob.id)]}


def _post(client, workspace, project, issue_ids, properties):
    return client.post(
        _url(workspace, project.id),
        {"issue_ids": issue_ids, "properties": properties},
        format="json",
    )


def _activity_payloads(issue_activity):
    return [
        (
            call.kwargs["type"],
            json.loads(call.kwargs["requested_data"]),
            json.loads(call.kwargs["current_instance"]) if call.kwargs["current_instance"] else None,
        )
        for call in issue_activity.delay.call_args_list
    ]


@pytest.mark.contract
class TestBulkUpdatePriority:
    @pytest.mark.django_db
    def test_sets_priority(self, session_client, workspace, project, issues, tasks, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            response = _post(session_client, workspace, project, _ids(issues), {"priority": "urgent"})
        assert response.status_code == status.HTTP_200_OK
        assert Issue.objects.filter(pk__in=_ids(issues), priority="urgent").count() == 3
        issue_activity, _ = tasks
        assert ("issue.activity.updated", {"priority": "urgent"}, {"priority": "none"}) in _activity_payloads(
            issue_activity
        )

    @pytest.mark.django_db
    def test_none_clears_priority(self, session_client, workspace, project, issues, tasks):
        Issue.objects.filter(pk__in=_ids(issues)).update(priority="high")
        response = _post(session_client, workspace, project, _ids(issues), {"priority": "none"})
        assert response.status_code == status.HTTP_200_OK
        assert Issue.objects.filter(pk__in=_ids(issues), priority="none").count() == 3

    @pytest.mark.django_db
    def test_unknown_priority_is_invalid(self, session_client, workspace, project, issues):
        response = _post(session_client, workspace, project, _ids(issues), {"priority": "critical"})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "invalid_value"


@pytest.mark.contract
class TestBulkUpdateDates:
    @pytest.mark.django_db
    def test_sets_start_date(
        self, session_client, workspace, project, issues, tasks, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = _post(session_client, workspace, project, _ids(issues), {"start_date": "2026-10-20"})
        assert response.status_code == status.HTTP_200_OK
        assert Issue.objects.filter(pk__in=_ids(issues), start_date=date(2026, 10, 20)).count() == 3
        issue_activity, _ = tasks
        assert ("issue.activity.updated", {"start_date": "2026-10-20"}, {"start_date": None}) in _activity_payloads(
            issue_activity
        )

    @pytest.mark.django_db
    def test_null_clears_target_date(self, session_client, workspace, project, issues, tasks):
        Issue.objects.filter(pk__in=_ids(issues)).update(target_date=date(2026, 11, 1))
        response = _post(session_client, workspace, project, _ids(issues), {"target_date": None})
        assert response.status_code == status.HTTP_200_OK
        assert Issue.objects.filter(pk__in=_ids(issues), target_date__isnull=True).count() == 3

    @pytest.mark.django_db
    @pytest.mark.parametrize("value", ["20/10/2026", "2026-13-01", 12])
    def test_invalid_date_is_rejected(self, session_client, workspace, project, issues, value):
        response = _post(session_client, workspace, project, _ids(issues), {"start_date": value})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "invalid_value"

    @pytest.mark.django_db
    def test_target_before_stored_start_fails_only_that_issue(self, session_client, workspace, project, issues, tasks):
        Issue.objects.filter(pk=issues[0].pk).update(start_date=date(2026, 10, 20))
        response = _post(session_client, workspace, project, _ids(issues), {"target_date": "2026-10-10"})
        assert response.status_code == status.HTTP_200_OK
        assert response.data["failed"] == [{"issue_id": str(issues[0].id), "code": "invalid_date_range"}]
        assert sorted(response.data["updated_issue_ids"]) == sorted(_ids(issues[1:]))
        issues[0].refresh_from_db()
        assert issues[0].target_date is None


@pytest.fixture
def front_label(project):
    return Label.objects.create(name="front", project=project, workspace=project.workspace)


@pytest.fixture
def back_label(project):
    return Label.objects.create(name="back", project=project, workspace=project.workspace)


@pytest.mark.contract
class TestBulkUpdateLabels:
    @pytest.mark.django_db
    def test_adds_label_and_keeps_existing(
        self, session_client, workspace, project, issues, front_label, back_label, tasks
    ):
        IssueLabel.objects.create(issue=issues[0], label=back_label, project=project, workspace=workspace)
        response = _post(session_client, workspace, project, _ids(issues), {"label_ids": [str(front_label.id)]})
        assert response.status_code == status.HTTP_200_OK
        assert set(IssueLabel.objects.filter(issue=issues[0]).values_list("label_id", flat=True)) == {
            front_label.id,
            back_label.id,
        }
        assert IssueLabel.objects.filter(label=front_label).count() == 3

    @pytest.mark.django_db
    def test_label_of_other_project_is_rejected(self, session_client, workspace, project, other_project, issues):
        foreign_label = Label.objects.create(name="foreign", project=other_project, workspace=workspace)
        response = _post(session_client, workspace, project, _ids(issues), {"label_ids": [str(foreign_label.id)]})
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "label_not_in_project"
        assert not IssueLabel.objects.filter(label=foreign_label).exists()

    @pytest.mark.django_db
    def test_activity_carries_full_label_set(
        self,
        session_client,
        workspace,
        project,
        issues,
        front_label,
        back_label,
        tasks,
        django_capture_on_commit_callbacks,
    ):
        IssueLabel.objects.create(issue=issues[0], label=back_label, project=project, workspace=workspace)
        with django_capture_on_commit_callbacks(execute=True):
            _post(session_client, workspace, project, [str(issues[0].id)], {"label_ids": [str(front_label.id)]})
        issue_activity, _ = tasks
        assert _activity_payloads(issue_activity) == [
            (
                "issue.activity.updated",
                {"label_ids": sorted([str(front_label.id), str(back_label.id)])},
                {"label_ids": [str(back_label.id)]},
            )
        ]


@pytest.fixture
def payment_module(project):
    return Module.objects.create(name="Paiement", project=project, workspace=project.workspace)


@pytest.mark.contract
class TestBulkUpdateModules:
    @pytest.mark.django_db
    def test_adds_module_and_keeps_existing(self, session_client, workspace, project, issues, payment_module, tasks):
        other_module = Module.objects.create(name="Other", project=project, workspace=workspace)
        ModuleIssue.objects.create(issue=issues[0], module=other_module, project=project, workspace=workspace)
        response = _post(session_client, workspace, project, _ids(issues), {"module_ids": [str(payment_module.id)]})
        assert response.status_code == status.HTTP_200_OK
        assert ModuleIssue.objects.filter(module=payment_module).count() == 3
        assert ModuleIssue.objects.filter(issue=issues[0], module=other_module).exists()

    @pytest.mark.django_db
    def test_archived_or_foreign_module_is_rejected(self, session_client, workspace, project, other_project, issues):
        archived = Module.objects.create(name="Old", project=project, workspace=workspace, archived_at=timezone.now())
        foreign = Module.objects.create(name="Foreign", project=other_project, workspace=workspace)
        for module in (archived, foreign):
            response = _post(session_client, workspace, project, _ids(issues), {"module_ids": [str(module.id)]})
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert response.data["code"] == "module_not_in_project"
            assert not ModuleIssue.objects.filter(module=module).exists()

    @pytest.mark.django_db
    def test_module_activity_only_for_new_links(
        self, session_client, workspace, project, issues, payment_module, tasks, django_capture_on_commit_callbacks
    ):
        ModuleIssue.objects.create(issue=issues[0], module=payment_module, project=project, workspace=workspace)
        with django_capture_on_commit_callbacks(execute=True):
            response = _post(session_client, workspace, project, _ids(issues), {"module_ids": [str(payment_module.id)]})
        assert response.data["unchanged_issue_ids"] == [str(issues[0].id)]
        issue_activity, _ = tasks
        calls = issue_activity.delay.call_args_list
        assert sorted(call.kwargs["issue_id"] for call in calls) == sorted(_ids(issues[1:]))
        for call in calls:
            assert call.kwargs["type"] == "module.activity.created"
            assert json.loads(call.kwargs["requested_data"]) == {"module_id": str(payment_module.id)}
            assert call.kwargs["current_instance"] is None


@pytest.mark.contract
class TestBulkUpdateMixedBatch:
    @pytest.mark.django_db
    def test_partition_of_a_mixed_batch(
        self, session_client, workspace, project, issues, create_user, tasks, django_capture_on_commit_callbacks
    ):
        extra = Issue(name="Work item 3", project=project, workspace=workspace)
        extra.save(created_by_id=create_user.id)
        late_start, already_due, updated_a, updated_b = issues[0], issues[1], issues[2], extra
        Issue.objects.filter(pk=late_start.pk).update(start_date=date(2026, 10, 20))
        Issue.objects.filter(pk=already_due.pk).update(target_date=date(2026, 10, 10))
        unknown_id = str(uuid4())
        requested = [unknown_id, *_ids([late_start, already_due, updated_a, updated_b])]

        with django_capture_on_commit_callbacks(execute=True):
            response = _post(session_client, workspace, project, requested, {"target_date": "2026-10-10"})

        assert response.status_code == status.HTTP_200_OK
        assert response.data["failed"] == [
            {"issue_id": unknown_id, "code": "not_found"},
            {"issue_id": str(late_start.id), "code": "invalid_date_range"},
        ]
        assert response.data["unchanged_issue_ids"] == [str(already_due.id)]
        assert response.data["updated_issue_ids"] == _ids([updated_a, updated_b])
        _assert_partition(response.data, requested)

        issue_activity, model_activity = tasks
        assert sorted(c.kwargs["issue_id"] for c in issue_activity.delay.call_args_list) == sorted(
            _ids([updated_a, updated_b])
        )
        assert sorted(c.kwargs["model_id"] for c in model_activity.delay.call_args_list) == sorted(
            _ids([updated_a, updated_b])
        )
