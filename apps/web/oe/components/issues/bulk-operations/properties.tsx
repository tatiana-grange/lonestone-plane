/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { CloseIcon } from "@plane/propel/icons";
import type { TBulkIssueProperties } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { ModuleDropdown } from "@/components/dropdowns/module/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { IssuePropertyLabels } from "@/components/issues/issue-layouts/properties/labels";
import { useProject } from "@/hooks/store/use-project";

type Props = {
  projectId: string;
  disabled: boolean;
  onApply: (properties: Partial<TBulkIssueProperties>) => void;
};

type DateControlProps = {
  disabled: boolean;
  placeholder: string;
  clearLabel: string;
  onChange: (date: string | null) => void;
};

function BulkDateControl(props: DateControlProps) {
  const { disabled, placeholder, clearLabel, onChange } = props;

  return (
    <div className="flex items-center gap-0.5">
      <DateDropdown
        value={null}
        buttonVariant="border-with-text"
        placeholder={placeholder}
        disabled={disabled}
        onChange={(date) => onChange(date ? (renderFormattedPayloadDate(date) ?? null) : null)}
      />
      {/* the dropdown starts empty, so its own clear icon never shows: clearing needs a dedicated control */}
      <button
        type="button"
        className="grid size-6 place-items-center rounded-sm text-tertiary hover:bg-layer-transparent-hover hover:text-secondary disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={clearLabel}
        title={clearLabel}
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        <CloseIcon className="size-3" />
      </button>
    </div>
  );
}

/**
 * One control per property. Controls always start empty: picking a value applies it
 * immediately to the whole selection.
 */
export const BulkPropertiesBar = observer(function BulkPropertiesBar(props: Props) {
  const { projectId, disabled, onApply } = props;
  const { t } = useTranslation();
  const { getProjectById } = useProject();
  const isModuleEnabled = !!getProjectById(projectId)?.module_view;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StateDropdown
        projectId={projectId}
        value={null}
        showDefaultState={false}
        buttonVariant="border-with-text"
        placeholder={t("bulk_operations.properties.state")}
        disabled={disabled}
        onChange={(stateId) => onApply({ state_id: stateId })}
      />
      <MemberDropdown
        projectId={projectId}
        multiple
        value={[]}
        buttonVariant="border-with-text"
        placeholder={t("bulk_operations.properties.assignees")}
        disabled={disabled}
        onChange={(assigneeIds) => {
          if (assigneeIds.length > 0) onApply({ assignee_ids: assigneeIds });
        }}
      />
      <PriorityDropdown
        value={null}
        buttonVariant="border-with-text"
        placeholder={t("bulk_operations.properties.priority")}
        disabled={disabled}
        onChange={(priority) => onApply({ priority })}
      />
      <BulkDateControl
        disabled={disabled}
        placeholder={t("bulk_operations.properties.start_date")}
        clearLabel={t("bulk_operations.clear_start_date")}
        onChange={(date) => onApply({ start_date: date })}
      />
      <BulkDateControl
        disabled={disabled}
        placeholder={t("bulk_operations.properties.due_date")}
        clearLabel={t("bulk_operations.clear_due_date")}
        onChange={(date) => onApply({ target_date: date })}
      />
      {isModuleEnabled && (
        <ModuleDropdown
          projectId={projectId}
          multiple
          value={[]}
          buttonVariant="border-with-text"
          placeholder={t("bulk_operations.properties.module")}
          disabled={disabled}
          onChange={(moduleIds) => {
            if (moduleIds.length > 0) onApply({ module_ids: moduleIds });
          }}
        />
      )}
      <IssuePropertyLabels
        projectId={projectId}
        value={[]}
        placeholderText={t("bulk_operations.properties.labels")}
        disabled={disabled}
        onChange={(labelIds) => {
          if (labelIds.length > 0) onApply({ label_ids: labelIds });
        }}
      />
    </div>
  );
});
