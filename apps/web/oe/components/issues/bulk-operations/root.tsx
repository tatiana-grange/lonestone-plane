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
import type { TBulkOperationsPayload } from "@plane/types";
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

// request-level error codes of the bulk API that have a translated reason
const FAILURE_CODES = new Set(["not_found", "invalid_date_range"]);

const getFailureReason = (error: unknown, t: TTranslate): string | undefined => {
  const { code, error: message } = (error ?? {}) as { code?: string; error?: string };
  if (code && FAILURE_CODES.has(code)) return t(`bulk_operations.failure_reasons.${code}`);
  return message;
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
      let sentCount = 0;
      try {
        // the API rejects a whole request when one work item cannot take the change: nothing is saved then
        for (let index = 0; index < issueIds.length; index += BULK_CHUNK_SIZE) {
          const chunkIds = issueIds.slice(index, index + BULK_CHUNK_SIZE);
          // sequential on purpose: chunks are rare and each one updates the store
          // oxlint-disable-next-line no-await-in-loop
          await issues.bulkUpdateProperties(workspaceSlug, projectId, { issue_ids: chunkIds, properties });
          sentCount += chunkIds.length;
        }
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("bulk_operations.toast.success_title"),
          message: t("bulk_operations.toast.success_message", { count: issueIds.length }),
        });
      } catch (error) {
        const reason = getFailureReason(error, t);
        if (sentCount > 0) {
          // the earlier batches are saved and already in the store
          setToast({
            type: TOAST_TYPE.WARNING,
            title: t("bulk_operations.toast.partial_title"),
            // toasts render plain text on one line
            message: [
              t("bulk_operations.toast.partial_message", { updated: sentCount, failed: issueIds.length - sentCount }),
              reason,
            ]
              .filter(Boolean)
              .join(" · "),
          });
          return;
        }
        // nothing was saved
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("bulk_operations.toast.error_title"),
          message: reason ?? t("bulk_operations.toast.error_message"),
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
