/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, observable } from "mobx";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

/**
 * Selection helpers of the board currently displayed. `BoardSelection` sits next to the board (not
 * around it), so the cards read the helpers from here instead of a React context.
 */
const boardSelectionHelpers = observable.box<TSelectionHelper | undefined>(undefined, { deep: false });

export const setBoardSelectionHelpers = action((helpers: TSelectionHelper | undefined) =>
  boardSelectionHelpers.set(helpers)
);

/** Selection helpers of the displayed board, or `undefined` when it is not selectable. Read inside an observer. */
export const getBoardSelectionHelpers = (): TSelectionHelper | undefined => boardSelectionHelpers.get();

/**
 * Selection group of a board card: its column, or its column × swimlane cell when the board is
 * sub-grouped. Always build ids with this.
 */
export const getBoardCellGroupId = (columnId: string, subGroupId?: string | null): string =>
  !subGroupId || subGroupId === "null" ? columnId : `${columnId}__${subGroupId}`;
