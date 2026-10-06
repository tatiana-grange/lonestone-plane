/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "react-router";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type { TBulkOperationsFailureCode, TBulkOperationsPayload, TBulkOperationsResponse } from "@plane/types";
import { cn } from "@plane/utils";
import { useIssues } from "@/hooks/store/use-issues";
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { useBulkOperationStatus } from "@/plane-web/hooks/use-bulk-operation-status";
import { BulkPropertiesBar } from "./properties";

// Mirrors the API limit of work items per request.
const BULK_CHUNK_SIZE = 500;

type Props = {
  className?: string;
  selectionHelpers: TSelectionHelper;
};

type TTranslate = ReturnType<typeof useTranslation>["t"];

const showBulkResultToast = (response: TBulkOperationsResponse, t: TTranslate) => {
  const updated = response.updated_issue_ids.length + response.unchanged_issue_ids.length;

  if (response.failed.length === 0) {
    setToast({
      type: TOAST_TYPE.SUCCESS,
      title: t("bulk_operations.toast.success_title"),
      message: t("bulk_operations.toast.success_message", { count: updated }),
    });
    return;
  }

  const countsByCode = new Map<TBulkOperationsFailureCode, number>();
  for (const { code } of response.failed) countsByCode.set(code, (countsByCode.get(code) ?? 0) + 1);
  const reasons = [...countsByCode].map(([code, count]) => t(`bulk_operations.failure_reasons.${code}`, { count }));

  setToast({
    type: TOAST_TYPE.WARNING,
    title: t("bulk_operations.toast.partial_title"),
    // toasts render plain text on one line, so reasons are joined inline
    message: [t("bulk_operations.toast.partial_message", { updated, failed: response.failed.length }), ...reasons].join(
      " · "
    ),
  });
};

export const IssueBulkOperationsRoot = observer(function IssueBulkOperationsRoot(props: Props) {
  const { className, selectionHelpers } = props;
  const { workspaceSlug, projectId } = useParams();
  const { t } = useTranslation();
  // store hooks
  const { isSelectionActive, selectedEntityIds } = useMultipleSelectStore();
  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  const isBulkOperationsEnabled = useBulkOperationStatus();
  // states
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isVisible = isSelectionActive && !selectionHelpers.isSelectionDisabled && isBulkOperationsEnabled;
  const { handleClearSelection } = selectionHelpers;

  const applyProperty = useCallback(
    async (properties: TBulkOperationsPayload["properties"]) => {
      if (!workspaceSlug || !projectId || selectedEntityIds.length === 0) return;
      setIsSubmitting(true);
      try {
        const response: TBulkOperationsResponse = { updated_issue_ids: [], unchanged_issue_ids: [], failed: [] };
        for (let index = 0; index < selectedEntityIds.length; index += BULK_CHUNK_SIZE) {
          // sequential on purpose: chunks are rare and each one updates the store
          // oxlint-disable-next-line no-await-in-loop
          const chunk = await issues.bulkUpdateProperties(workspaceSlug, projectId, {
            issue_ids: selectedEntityIds.slice(index, index + BULK_CHUNK_SIZE),
            properties,
          });
          response.updated_issue_ids.push(...chunk.updated_issue_ids);
          response.unchanged_issue_ids.push(...chunk.unchanged_issue_ids);
          response.failed.push(...chunk.failed);
        }
        showBulkResultToast(response, t);
      } catch (error) {
        // nothing was applied to the store: it is only updated after a successful response
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("bulk_operations.toast.error_title"),
          message: (error as { error?: string } | undefined)?.error ?? t("bulk_operations.toast.error_message"),
        });
      } finally {
        // the selection is intentionally kept so that several properties can be applied in a row
        setIsSubmitting(false);
      }
    },
    [issues, projectId, selectedEntityIds, t, workspaceSlug]
  );

  if (!isVisible || !projectId) return null;

  return (
    <div
      data-testid="bulk-operations-bar"
      className={cn("sticky bottom-0 left-0 z-[2] grid h-20 place-items-center px-3.5", className)}
    >
      <div className="flex min-h-14 w-full flex-wrap items-center gap-3 rounded-md border-[0.5px] border-subtle bg-surface-1 px-3.5 py-2 shadow-raised-200">
        <span className="text-13 font-medium whitespace-nowrap text-primary" aria-live="polite" aria-atomic="true">
          {t("bulk_operations.selected_count", { count: selectedEntityIds.length })}
        </span>
        <Button variant="link" size="sm" onClick={handleClearSelection}>
          {t("bulk_operations.clear_selection")}
        </Button>
        <div className="h-5 border-l border-subtle" />
        <BulkPropertiesBar
          projectId={projectId}
          disabled={isSubmitting}
          onApply={(properties) => void applyProperty(properties)}
        />
      </div>
    </div>
  );
});
