/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import { observer } from "mobx-react";
import { cn } from "@plane/utils";
import { MultipleSelectEntityAction } from "@/components/core/multiple-select";
import { getBoardCellGroupId, getBoardSelectionHelpers } from "./helpers-store";
import { useTouchSelection } from "./use-touch-selection";

type Props = {
  issueId: string;
  groupId: string;
  subGroupId?: string | null;
};

/**
 * Selection layer of a board card, rendered inside the card wrapper (which is `relative`):
 * - a checkbox, revealed on hover or keyboard focus, always visible once selected, hidden on touch screens;
 * - an accent border over the card while it is selected;
 * - touch selection (long press, tap while a selection is active) on the card wrapper.
 */
export const BoardCardSelection = observer(function BoardCardSelection(props: Props) {
  const { issueId, groupId, subGroupId } = props;
  const anchorRef = useRef<HTMLSpanElement>(null);
  const helpers = getBoardSelectionHelpers();
  const selectionGroupId = getBoardCellGroupId(groupId, subGroupId);

  useTouchSelection({ anchorRef, helpers, entityID: issueId, groupID: selectionGroupId });

  if (!helpers || helpers.isSelectionDisabled) return null;

  const isSelected = helpers.getIsEntitySelected(issueId);

  return (
    <>
      {isSelected && (
        <span className="pointer-events-none absolute inset-0 rounded-lg border border-accent-strong" aria-hidden />
      )}
      <span
        ref={anchorRef}
        className={cn(
          "absolute top-1 left-1 grid size-6 place-items-center rounded-sm bg-layer-2 opacity-0 transition-opacity group-hover/kanban-block:opacity-100 focus-within:opacity-100 [@media(hover:none)]:hidden",
          { "opacity-100": isSelected }
        )}
      >
        <MultipleSelectEntityAction
          className="focus-visible:ring-2 focus-visible:ring-accent-strong"
          id={issueId}
          groupId={selectionGroupId}
          selectionHelpers={helpers}
        />
      </span>
    </>
  );
});
