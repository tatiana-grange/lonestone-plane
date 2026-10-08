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
import { BulkPropertiesBar } from "./properties";

// Mirrors the API limit of work items per request.
const BULK_CHUNK_SIZE = 500;

type Props = {
  className?: string;
  selectionHelpers: TSelectionHelper;
};

type TTranslate = ReturnType<typeof useTranslation>["t"];

/**
 * @param notSentCount work items of the batches that were not sent because an earlier batch request failed
 */
const showBulkResultToast = (response: TBulkOperationsResponse, t: TTranslate, notSentCount = 0) => {
  const updated = response.updated_issue_ids.length + response.unchanged_issue_ids.length;

  if (response.failed.length === 0 && notSentCount === 0) {
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
  if (notSentCount > 0) reasons.push(t("bulk_operations.failure_reasons.request_failed", { count: notSentCount }));
  const failed = response.failed.length + notSentCount;

  setToast({
    type: TOAST_TYPE.WARNING,
    title: t("bulk_operations.toast.partial_title"),
    // toasts render plain text on one line, so reasons are joined inline
    message: [t("bulk_operations.toast.partial_message", { updated, failed }), ...reasons].join(" · "),
  });
};

/**
 * Bulk actions bar. Rendered by the upstream `IssueBulkOperationsRoot` in place of its "Upgrade"
 * banner, once a selection is active and enabled.
 */
export const BulkOperationsBar = observer(function BulkOperationsBar(props: Props) {
  const { className, selectionHelpers } = props;
  const { workspaceSlug, projectId } = useParams();
  const { t } = useTranslation();
  // store hooks
  const { selectedEntityIds } = useMultipleSelectStore();
  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  // states
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { handleClearSelection } = selectionHelpers;

  const applyProperty = useCallback(
    async (properties: TBulkOperationsPayload["properties"]) => {
      if (!workspaceSlug || !projectId || selectedEntityIds.length === 0) return;
      setIsSubmitting(true);
      // a copy: each batch updates the store, which can drop work items from the view and so from the selection
      const issueIds = [...selectedEntityIds];
      const response: TBulkOperationsResponse = { updated_issue_ids: [], unchanged_issue_ids: [], failed: [] };
      let sentCount = 0;
      try {
        for (let index = 0; index < issueIds.length; index += BULK_CHUNK_SIZE) {
          const chunkIds = issueIds.slice(index, index + BULK_CHUNK_SIZE);
          // sequential on purpose: chunks are rare and each one updates the store
          // oxlint-disable-next-line no-await-in-loop
          const chunk = await issues.bulkUpdateProperties(workspaceSlug, projectId, {
            issue_ids: chunkIds,
            properties,
          });
          response.updated_issue_ids.push(...chunk.updated_issue_ids);
          response.unchanged_issue_ids.push(...chunk.unchanged_issue_ids);
          response.failed.push(...chunk.failed);
          sentCount += chunkIds.length;
        }
        showBulkResultToast(response, t);
      } catch (error) {
        if (sentCount > 0) {
          // the earlier batches are saved and already in the store: report them with the ones not sent
          showBulkResultToast(response, t, issueIds.length - sentCount);
          return;
        }
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

  if (!projectId) return null;

  return (
    <div className={cn("sticky bottom-0 left-0 z-[2] grid h-20 place-items-center px-3.5", className)}>
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
