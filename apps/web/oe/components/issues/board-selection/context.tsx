/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

type TBoardSelectionContext = {
  helpers: TSelectionHelper | undefined;
  // every selection group (cell) of the board, see getBoardCellGroupId
  groupIds: string[];
};

const BoardSelectionContext = createContext<TBoardSelectionContext>({ helpers: undefined, groupIds: [] });

/**
 * Hands the board's selection helpers down to cards and column headers without threading a prop
 * through every kanban level (columns, swimlanes, groups, block lists).
 */
export function BoardSelectionProvider(props: {
  helpers: TSelectionHelper | undefined;
  groupIds: string[];
  children: ReactNode;
}) {
  const { helpers, groupIds, children } = props;
  const value = useMemo(() => ({ helpers, groupIds }), [helpers, groupIds]);
  return <BoardSelectionContext.Provider value={value}>{children}</BoardSelectionContext.Provider>;
}

/** Selection helpers of the surrounding board, or `undefined` outside a selectable board. */
export const useBoardSelection = (): TSelectionHelper | undefined => useContext(BoardSelectionContext).helpers;

/** Selection groups (cells) of a column: the column itself, or one cell per swimlane. */
export const useBoardColumnGroupIds = (columnId: string): string[] => {
  const { groupIds } = useContext(BoardSelectionContext);
  return useMemo(
    () => groupIds.filter((groupId) => groupId === columnId || groupId.startsWith(`${columnId}__`)),
    [columnId, groupIds]
  );
};

/**
 * Selection group of a board card: its column, or its column × swimlane cell when the board is
 * sub-grouped, so that a shift + click range never leaves the cell. Always build ids with this.
 */
export const getBoardCellGroupId = (columnId: string, subGroupId?: string | null): string =>
  !subGroupId || subGroupId === "null" ? columnId : `${columnId}__${subGroupId}`;
