/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
// controls inside a card (property dropdowns, quick actions, the menus they open) keep their own tap
const INTERACTIVE_SELECTOR =
  "button, input, select, textarea, [contenteditable='true'], [role='button'], [role='checkbox'], [role='menuitem'], [role='option']";

type TouchSelectionHandlers = {
  onPointerDown?: (event: PointerEvent) => void;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  onClickCapture?: (event: MouseEvent) => void;
};

/**
 * Touch selection for board cards (no hover, so no checkbox):
 * - a long press (about 500 ms without moving) toggles the card instead of opening it;
 * - while a selection is active, a tap toggles the card instead of opening it, except on the card's
 *   controls (state, assignees, "..." menu), which keep working.
 * Moving the finger cancels the long press, so scrolling stays free.
 */
export const useTouchSelection = (params: {
  helpers: TSelectionHelper | undefined;
  entityID: string;
  groupID: string;
}): TouchSelectionHandlers => {
  const { helpers, entityID, groupID } = params;
  const { isSelectionActive } = useMultipleSelectStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);
  const longPressDoneRef = useRef(false);

  const cancelTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => cancelTimer, []);

  if (!helpers || helpers.isSelectionDisabled) return {};

  return {
    onPointerDown: (event) => {
      lastPointerTypeRef.current = event.pointerType;
      longPressDoneRef.current = false;
      if (event.pointerType !== "touch") return;
      startRef.current = { x: event.clientX, y: event.clientY };
      cancelTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        longPressDoneRef.current = true;
        // no shift key on touch: a plain toggle
        helpers.handleEntityClick(event, entityID, groupID);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      if (!timerRef.current || !startRef.current) return;
      const distance = Math.hypot(event.clientX - startRef.current.x, event.clientY - startRef.current.y);
      if (distance > MOVE_TOLERANCE_PX) cancelTimer();
    },
    onPointerUp: cancelTimer,
    onPointerCancel: cancelTimer,
    onContextMenu: (event) => {
      // the long press must not open the native link menu
      if (lastPointerTypeRef.current === "touch") event.preventDefault();
    },
    onClickCapture: (event) => {
      if (longPressDoneRef.current) {
        longPressDoneRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const isOnControl = event.target instanceof Element && !!event.target.closest(INTERACTIVE_SELECTOR);
      if (lastPointerTypeRef.current === "touch" && isSelectionActive && !isOnControl) {
        event.preventDefault();
        event.stopPropagation();
        helpers.handleEntityClick(event, entityID, groupID);
      }
    },
  };
};
