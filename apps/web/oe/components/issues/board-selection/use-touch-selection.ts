/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
// controls inside a card (property dropdowns, quick actions, the menus they open) keep their own tap
const INTERACTIVE_SELECTOR =
  "button, input, select, textarea, [contenteditable='true'], [role='button'], [role='checkbox'], [role='menuitem'], [role='option']";

/**
 * Touch selection for board cards (no hover, so no checkbox), wired on the card wrapper, i.e. the
 * parent of `anchorRef`, with native listeners so that the upstream card stays untouched:
 * - a long press (about 500 ms without moving) toggles the card instead of opening it;
 * - while a selection is active, a tap toggles the card instead of opening it, except on the card's
 *   controls (state, assignees, "..." menu), which keep working.
 * Moving the finger cancels the long press, so scrolling stays free.
 */
export const useTouchSelection = (params: {
  anchorRef: RefObject<HTMLElement>;
  helpers: TSelectionHelper | undefined;
  entityID: string;
  groupID: string;
}) => {
  const { anchorRef, helpers, entityID, groupID } = params;
  const { isSelectionActive } = useMultipleSelectStore();

  useEffect(() => {
    const card = anchorRef.current?.parentElement;
    if (!card || !helpers || helpers.isSelectionDisabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let start: { x: number; y: number } | null = null;
    let lastPointerType: string | null = null;
    let longPressDone = false;

    // no shift key on touch: handleEntityClick toggles the card
    const toggle = (event: Event) => helpers.handleEntityClick(event as unknown as ReactMouseEvent, entityID, groupID);
    const cancelTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      lastPointerType = event.pointerType;
      longPressDone = false;
      if (event.pointerType !== "touch") return;
      start = { x: event.clientX, y: event.clientY };
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        longPressDone = true;
        toggle(event);
      }, LONG_PRESS_MS);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!timer || !start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancelTimer();
    };
    const onContextMenu = (event: MouseEvent) => {
      // the long press must not open the native link menu
      if (lastPointerType === "touch") event.preventDefault();
    };
    // capture phase on the wrapper: runs before the card link opens the work item
    const onClickCapture = (event: MouseEvent) => {
      if (longPressDone) {
        longPressDone = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const isOnControl = event.target instanceof Element && !!event.target.closest(INTERACTIVE_SELECTOR);
      if (lastPointerType === "touch" && isSelectionActive && !isOnControl) {
        event.preventDefault();
        event.stopPropagation();
        toggle(event);
      }
    };

    // no native "copy / open link" callout on the long press (iOS)
    card.style.setProperty("-webkit-touch-callout", "none");
    card.addEventListener("pointerdown", onPointerDown);
    card.addEventListener("pointermove", onPointerMove);
    card.addEventListener("pointerup", cancelTimer);
    card.addEventListener("pointercancel", cancelTimer);
    card.addEventListener("contextmenu", onContextMenu);
    card.addEventListener("click", onClickCapture, true);
    return () => {
      cancelTimer();
      card.style.removeProperty("-webkit-touch-callout");
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("pointermove", onPointerMove);
      card.removeEventListener("pointerup", cancelTimer);
      card.removeEventListener("pointercancel", cancelTimer);
      card.removeEventListener("contextmenu", onContextMenu);
      card.removeEventListener("click", onClickCapture, true);
    };
  }, [anchorRef, helpers, entityID, groupID, isSelectionActive]);
};
