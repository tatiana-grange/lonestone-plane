/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { CloseIcon } from "@plane/propel/icons";
import type { TBulkOperationsPayload } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { useProject } from "@/hooks/store/use-project";
import { BulkAssigneesMenu, BulkLabelsMenu, BulkModulesMenu } from "./multi-value-menus";

type Props = {
  projectId: string;
  disabled: boolean;
  onApply: (properties: TBulkOperationsPayload["properties"]) => void;
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
        placeholder={t("state")}
        disabled={disabled}
        onChange={(stateId) => onApply({ state_id: stateId })}
      />
      <BulkAssigneesMenu projectId={projectId} disabled={disabled} onApply={onApply} />
      <PriorityDropdown
        value={null}
        buttonVariant="border-with-text"
        placeholder={t("priority")}
        disabled={disabled}
        onChange={(priority) => onApply({ priority })}
      />
      <BulkDateControl
        disabled={disabled}
        placeholder={t("start_date")}
        clearLabel={t("bulk_operations.clear_start_date")}
        onChange={(date) => onApply({ start_date: date })}
      />
      <BulkDateControl
        disabled={disabled}
        placeholder={t("due_date")}
        clearLabel={t("bulk_operations.clear_due_date")}
        onChange={(date) => onApply({ target_date: date })}
      />
      {isModuleEnabled && <BulkModulesMenu projectId={projectId} disabled={disabled} onApply={onApply} />}
      <BulkLabelsMenu projectId={projectId} disabled={disabled} onApply={onApply} />
    </div>
  );
});
