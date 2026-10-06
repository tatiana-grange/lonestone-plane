/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { observer } from "mobx-react";
import { useParams } from "react-router";
import { useTranslation } from "@plane/i18n";
import type { TBulkOperationsPayload, TIssue } from "@plane/types";
import { Avatar } from "@plane/ui";
import { getFileURL } from "@plane/utils";
import { ModuleIcon } from "@plane/propel/icons";
import { useIssues } from "@/hooks/store/use-issues";
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useModule } from "@/hooks/store/use-module";
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import type { TBulkTriStateOption } from "./tri-state-menu";
import { BulkTriStateMenu } from "./tri-state-menu";

export type TBulkMenuProps = {
  projectId: string;
  disabled: boolean;
  onApply: (properties: TBulkOperationsPayload["properties"]) => void;
};

/** Counts, among the selected work items, those whose multi-value field contains a given value. */
const useSelectionValueCount = (field: "assignee_ids" | "label_ids" | "module_ids") => {
  const { selectedEntityIds } = useMultipleSelectStore();
  const { issueMap } = useIssues(useIssueStoreType());

  const getCount = useCallback(
    (valueId: string) =>
      selectedEntityIds.filter((issueId) => {
        const values = (issueMap[issueId] as TIssue | undefined)?.[field];
        return Array.isArray(values) && values.includes(valueId);
      }).length,
    [field, issueMap, selectedEntityIds]
  );

  return { getCount, selectedCount: selectedEntityIds.length };
};

export const BulkAssigneesMenu = observer(function BulkAssigneesMenu(props: TBulkMenuProps) {
  const { projectId, disabled, onApply } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const {
    getUserDetails,
    project: { getProjectMemberIds, fetchProjectMembers },
  } = useMember();
  const { getCount, selectedCount } = useSelectionValueCount("assignee_ids");

  // members only (no guests): the same list as the assignee dropdown
  const memberIds = getProjectMemberIds(projectId, false);
  const options: TBulkTriStateOption[] = (memberIds ?? []).map((memberId) => {
    const user = getUserDetails(memberId);
    return {
      id: memberId,
      label: user?.display_name ?? "",
      icon: <Avatar name={user?.display_name} src={getFileURL(user?.avatar_url ?? "")} size="sm" />,
    };
  });

  return (
    <BulkTriStateMenu
      label={t("bulk_operations.properties.assignees")}
      options={options}
      getCount={getCount}
      selectedCount={selectedCount}
      disabled={disabled}
      onOpen={() => {
        if (!memberIds && workspaceSlug) void fetchProjectMembers(workspaceSlug, projectId);
      }}
      onAdd={(memberId) => onApply({ assignee_ids: [memberId] })}
      onRemove={(memberId) => onApply({ remove_assignee_ids: [memberId] })}
    />
  );
});

export const BulkLabelsMenu = observer(function BulkLabelsMenu(props: TBulkMenuProps) {
  const { projectId, disabled, onApply } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const { getProjectLabels, fetchProjectLabels } = useLabel();
  const { getCount, selectedCount } = useSelectionValueCount("label_ids");

  const labels = getProjectLabels(projectId);
  const options: TBulkTriStateOption[] = (labels ?? []).map((label) => ({
    id: label.id,
    label: label.name,
    icon: (
      <span aria-hidden="true" className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
    ),
  }));

  return (
    <BulkTriStateMenu
      label={t("bulk_operations.properties.labels")}
      options={options}
      getCount={getCount}
      selectedCount={selectedCount}
      disabled={disabled}
      onOpen={() => {
        if (!labels && workspaceSlug) void fetchProjectLabels(workspaceSlug, projectId);
      }}
      onAdd={(labelId) => onApply({ label_ids: [labelId] })}
      onRemove={(labelId) => onApply({ remove_label_ids: [labelId] })}
    />
  );
});

export const BulkModulesMenu = observer(function BulkModulesMenu(props: TBulkMenuProps) {
  const { projectId, disabled, onApply } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const { getProjectModuleIds, getModuleById, fetchModules } = useModule();
  const { getCount, selectedCount } = useSelectionValueCount("module_ids");

  const moduleIds = getProjectModuleIds(projectId);
  const options: TBulkTriStateOption[] = (moduleIds ?? []).flatMap((moduleId) => {
    const projectModule = getModuleById(moduleId);
    // archived modules are not part of a work item's values (same as the module dropdown)
    if (!projectModule || projectModule.archived_at) return [];
    return [{ id: moduleId, label: projectModule.name, icon: <ModuleIcon className="size-3 flex-shrink-0" /> }];
  });

  return (
    <BulkTriStateMenu
      label={t("bulk_operations.properties.module")}
      options={options}
      getCount={getCount}
      selectedCount={selectedCount}
      disabled={disabled}
      onOpen={() => {
        if (!moduleIds && workspaceSlug) void fetchModules(workspaceSlug, projectId);
      }}
      onAdd={(moduleId) => onApply({ module_ids: [moduleId] })}
      onRemove={(moduleId) => onApply({ remove_module_ids: [moduleId] })}
    />
  );
});
