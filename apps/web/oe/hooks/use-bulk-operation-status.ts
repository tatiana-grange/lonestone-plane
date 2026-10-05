/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "react-router";
import { EIssuesStoreType } from "@plane/types";
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useProjectCollaboration } from "@/hooks/use-project-collaboration";

const BULK_OPERATION_STORE_TYPES = new Set<EIssuesStoreType>([
  EIssuesStoreType.PROJECT,
  EIssuesStoreType.CYCLE,
  EIssuesStoreType.MODULE,
  EIssuesStoreType.PROJECT_VIEW,
]);

/**
 * Bulk operations are enabled only inside a single project's work item views (project,
 * cycle, module, saved view), for users allowed to edit its work items, and never on a
 * completed cycle. Must be called from an observer component.
 */
export const useBulkOperationStatus = (): boolean => {
  const { workspaceSlug, projectId, cycleId } = useParams();
  const storeType = useIssueStoreType();
  const { canEditProjectWorkItems } = useProjectCollaboration();
  const { currentProjectCompletedCycleIds } = useCycle();

  if (!workspaceSlug || !projectId) return false;
  if (!BULK_OPERATION_STORE_TYPES.has(storeType)) return false;
  if (cycleId && currentProjectCompletedCycleIds?.includes(cycleId)) return false;
  return canEditProjectWorkItems(workspaceSlug, projectId);
};
