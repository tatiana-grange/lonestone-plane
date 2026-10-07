/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MutableRefObject, ReactNode } from "react";
import { observer } from "mobx-react";
import type { TGroupedIssues, TSubGroupedIssues } from "@plane/types";
// components
import { MultipleSelectGroup } from "@/components/core/multiple-select";
import { isSubGrouped } from "@/components/issues/issue-layouts/utils";
// hooks
import { useBulkOperationStatus } from "@/hooks/use-bulk-operation-status";
// plane web components
import { IssueBulkOperationsRoot } from "@/plane-web/components/issues/bulk-operations";
import { BoardSelectionProvider, getBoardCellGroupId } from "./context";

type Props = {
  children: ReactNode;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined;
  isEpic?: boolean;
};

/**
 * Board multi-select: wraps the board's scroll container with the selection group, shares the
 * selection helpers with cards and column headers, and renders the bulk bar below the board.
 */
export const BoardSelectionRoot = observer(function BoardSelectionRoot(props: Props) {
  const { children, containerRef, groupedIssueIds, isEpic = false } = props;
  const isBulkOperationsEnabled = useBulkOperationStatus();

  // Selection groups: one per column, or per column x swimlane cell when sub-grouped, so a shift +
  // click range stays within a cell. Only the order of cards inside a cell matters.
  // Built on every render, like the list layout: groupedIssueIds is a MobX object mutated in place, so
  // a memo on its reference would keep stale groups once cards move between columns.
  const selectionEntities: Record<string, string[]> = {};
  if (groupedIssueIds && isSubGrouped(groupedIssueIds as TGroupedIssues)) {
    Object.entries(groupedIssueIds as TSubGroupedIssues).forEach(([columnId, cells]) => {
      Object.entries(cells ?? {}).forEach(([subGroupId, issueIds]) => {
        selectionEntities[getBoardCellGroupId(columnId, subGroupId)] = [...(issueIds ?? [])];
      });
    });
  } else if (groupedIssueIds) {
    Object.entries(groupedIssueIds as TGroupedIssues).forEach(([columnId, issueIds]) => {
      selectionEntities[getBoardCellGroupId(columnId)] = [...(issueIds ?? [])];
    });
  }

  return (
    <MultipleSelectGroup
      containerRef={containerRef}
      entities={selectionEntities}
      disabled={!isBulkOperationsEnabled || isEpic}
      rangeScope="group"
    >
      {(helpers) => (
        <BoardSelectionProvider helpers={helpers} groupIds={Object.keys(selectionEntities)}>
          {/* the board's scroll container shrinks (it has an overflow) to leave room for the bar */}
          <div className="relative flex h-full w-full flex-col">
            {children}
            <IssueBulkOperationsRoot selectionHelpers={helpers} />
          </div>
        </BoardSelectionProvider>
      )}
    </MultipleSelectGroup>
  );
});
