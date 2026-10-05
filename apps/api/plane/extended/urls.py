# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Extended edition URL routes."""

from django.urls import path

from plane.extended.views import (
    ProjectGuestCollaborationEndpoint,
    ProjectIssueBulkUpdateEndpoint,
    ProjectTemplateApplyEndpoint,
    ProjectTemplateEndpoint,
    ProjectTemplatePreviewEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/project-templates/",
        ProjectTemplateEndpoint.as_view(),
        name="extended-project-templates",
    ),
    path(
        "workspaces/<str:slug>/project-templates/preview/",
        ProjectTemplatePreviewEndpoint.as_view(),
        name="extended-project-template-preview",
    ),
    path(
        "workspaces/<str:slug>/project-templates/<uuid:pk>/",
        ProjectTemplateEndpoint.as_view(),
        name="extended-project-template-detail",
    ),
    path(
        "workspaces/<str:slug>/project-templates/<uuid:pk>/apply/",
        ProjectTemplateApplyEndpoint.as_view(),
        name="extended-project-template-apply",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/guest-collaboration/",
        ProjectGuestCollaborationEndpoint.as_view(),
        name="extended-project-guest-collaboration",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/bulk-update/",
        ProjectIssueBulkUpdateEndpoint.as_view(),
        name="extended-project-issues-bulk-update",
    ),
]
