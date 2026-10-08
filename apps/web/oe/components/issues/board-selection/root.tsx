/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { observer } from "mobx-react";
import type { TGroupedIssues, TSubGroupedIssues } from "@plane/types";
// components
import { MultipleSelectGroup } from "@/components/core/multiple-select";
import { isSubGrouped } from "@/components/issues/issue-layouts/utils";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
// hooks
import { useBulkOperationStatus } from "@/plane-web/hooks/use-bulk-operation-status";
// plane web components
import { IssueBulkOperationsRoot } from "@/plane-web/components/issues/bulk-operations";
import { getBoardCellGroupId, setBoardSelectionHelpers } from "./helpers-store";

type Props = {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues | undefined;
  isEpic?: boolean;
};

/** Hands the current helpers to the cards (see helpers-store), and clears them when the board goes away. */
function PublishBoardSelectionHelpers(props: { helpers: TSelectionHelper }) {
  const { helpers } = props;
  useEffect(() => {
    setBoardSelectionHelpers(helpers);
  }, [helpers]);
  useEffect(() => () => setBoardSelectionHelpers(undefined), []);
  return null;
}

/**
 * Board multi-select, rendered next to the board's scroll container: builds the selection groups,
 * shares the selection helpers with the cards and renders the bulk bar over the bottom of the board.
 */
export const BoardSelection = observer(function BoardSelection(props: Props) {
  const { containerRef, groupedIssueIds, isEpic = false } = props;
  const isBulkOperationsEnabled = useBulkOperationStatus();

  // Selection groups: one per column, or per column x swimlane cell when sub-grouped.
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
    >
      {(helpers) => (
        <>
          <PublishBoardSelectionHelpers helpers={helpers} />
          {/* the board fills its container: the bar sits over its bottom edge */}
          <IssueBulkOperationsRoot className="absolute right-0" selectionHelpers={helpers} />
        </>
      )}
    </MultipleSelectGroup>
  );
});
