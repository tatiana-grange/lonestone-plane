/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

// Clicks on these keep the selection: work items, controls, the bulk bar and open overlays.
const KEEP_SELECTION_TARGETS = [
  "[data-selection-entity-id]",
  "a",
  "button",
  "input",
  "label",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='menu']",
  "[role='listbox']",
  "[role='dialog']",
  "[data-testid='bulk-operations-bar']",
  // spreadsheet rows and gantt bars, which are clickable without a role
  "tr",
  "[id^='gantt-block-']",
  // Plane marks clickable areas without a role this way (e.g. list group headers that collapse)
  ".cursor-pointer",
  ".clickable",
].join(", ");

/**
 * A plain click on an empty area of the layout (between rows, below the list, empty board space)
 * clears the selection, like Linear or a file manager. Clicks with Cmd/Ctrl/Shift/Alt, on work items,
 * on controls or inside menus keep it.
 */
export const useClearSelectionOnBackgroundClick = (params: {
  containerRef: MutableRefObject<HTMLElement | null>;
  helpers: TSelectionHelper;
  disabled: boolean;
}) => {
  const { containerRef, helpers, disabled } = params;

  useEffect(() => {
    const container = containerRef.current;
    if (disabled || !container) return;

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element) || event.target.closest(KEEP_SELECTION_TARGETS)) return;
      // a text selection made by dragging is not a background click
      if (window.getSelection()?.toString()) return;
      helpers.handleClearSelection();
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [containerRef, disabled, helpers]);
};
