# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Envelope validation for the bulk update work items endpoint."""

from uuid import UUID

from rest_framework import serializers

MAX_BULK_ISSUES = 500

SUPPORTED_PROPERTIES = (
    "state_id",
    "priority",
    "start_date",
    "target_date",
    "assignee_ids",
    "label_ids",
    "module_ids",
    "remove_assignee_ids",
    "remove_label_ids",
    "remove_module_ids",
)

# add key -> removal key of the same multi-value property
ADD_REMOVE_PAIRS = (
    ("assignee_ids", "remove_assignee_ids"),
    ("label_ids", "remove_label_ids"),
    ("module_ids", "remove_module_ids"),
)


class BulkUpdateValidationError(Exception):
    """A request-level validation error, rendered as ``400 {"error", "code"}``."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class IssueBulkUpdateSerializer(serializers.Serializer):
    """Validates ``{issue_ids, properties}``.

    Raises ``BulkUpdateValidationError`` instead of DRF errors so every 400 carries a
    stable ``code``. Values of each property are validated by the service handlers.
    """

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise BulkUpdateValidationError("invalid_value", "Request body must be an object")

        raw_ids = data.get("issue_ids")
        if not raw_ids:
            raise BulkUpdateValidationError("issue_ids_required", "issue_ids is required")
        if not isinstance(raw_ids, list):
            raise BulkUpdateValidationError("invalid_value", "issue_ids must be a list")

        issue_ids = []
        seen = set()
        for raw_id in raw_ids:
            try:
                issue_id = str(UUID(str(raw_id)))
            except (TypeError, ValueError):
                raise BulkUpdateValidationError("invalid_value", "issue_ids must contain UUIDs")
            if issue_id not in seen:
                seen.add(issue_id)
                issue_ids.append(issue_id)

        if len(issue_ids) > MAX_BULK_ISSUES:
            raise BulkUpdateValidationError(
                "too_many_issues", f"At most {MAX_BULK_ISSUES} work items can be updated at once"
            )

        properties = data.get("properties")
        if not properties:
            raise BulkUpdateValidationError("properties_required", "properties is required")
        if not isinstance(properties, dict):
            raise BulkUpdateValidationError("invalid_value", "properties must be an object")

        unsupported = [key for key in properties if key not in SUPPORTED_PROPERTIES]
        if unsupported:
            raise BulkUpdateValidationError(
                "unsupported_property", f"Unsupported properties: {', '.join(sorted(unsupported))}"
            )

        for _, remove_key in ADD_REMOVE_PAIRS:
            if remove_key not in properties:
                continue
            values = properties[remove_key]
            if not isinstance(values, list) or not values:
                raise BulkUpdateValidationError("invalid_value", f"{remove_key} must be a non-empty list of UUIDs")
            for value in values:
                try:
                    UUID(str(value))
                except (TypeError, ValueError):
                    raise BulkUpdateValidationError("invalid_value", f"{remove_key} must contain UUIDs")

        # one operation per property: adding and removing in one request would log two contradictory sets
        if any(add_key in properties and remove_key in properties for add_key, remove_key in ADD_REMOVE_PAIRS):
            raise BulkUpdateValidationError(
                "invalid_value", "A property cannot be added and removed in the same request"
            )

        return {"issue_ids": issue_ids, "properties": dict(properties)}
