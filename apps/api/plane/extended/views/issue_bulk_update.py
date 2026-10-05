# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Project
from plane.extended.serializers import BulkUpdateValidationError, IssueBulkUpdateSerializer
from plane.extended.services import bulk_update_issues
from plane.utils.host import base_host


class ProjectIssueBulkUpdateEndpoint(BaseAPIView):
    """POST: apply one or more properties to several work items of a project."""

    def post(self, request, slug, project_id):
        # Checked before the permission decorator, which answers 403 for unknown projects.
        if not Project.objects.filter(id=project_id, workspace__slug=slug).exists():
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        return self._bulk_update(request, slug=slug, project_id=project_id)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], allow_collaborating_guest=True)
    def _bulk_update(self, request, slug, project_id):
        try:
            serializer = IssueBulkUpdateSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            result = bulk_update_issues(
                slug=slug,
                project_id=project_id,
                issue_ids=serializer.validated_data["issue_ids"],
                properties=serializer.validated_data["properties"],
                actor=request.user,
                origin=base_host(request=request, is_app=True),
            )
        except BulkUpdateValidationError as error:
            return Response({"error": error.message, "code": error.code}, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_200_OK)
