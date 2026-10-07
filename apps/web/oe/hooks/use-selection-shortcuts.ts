/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset"]);

/** Typing targets keep their native shortcuts (select all text, type "x", leave the field). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return !!target.closest('[contenteditable="true"], .ProseMirror');
}

/**
 * An open dialog, menu, listbox or floating work item peek handles the keyboard first
 * (Escape closes it before clearing the selection).
 */
function isOverlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-selection-overlay]');
}

/**
 * Selection shortcuts shared by every layout that supports multi-select:
 * - Escape clears the selection;
 * - Cmd/Ctrl + A selects every displayed work item;
 * - X toggles the work item under the pointer (elements tagged with `data-selection-entity-id`).
 */
export const useSelectionShortcuts = (params: { helpers: TSelectionHelper; disabled: boolean }) => {
  const { helpers, disabled } = params;

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target) || isOverlayOpen()) return;
      const key = event.key.toLowerCase();
      const hasCommandModifier = event.metaKey || event.ctrlKey;

      if (key === "escape" && !hasCommandModifier && !event.altKey && !event.shiftKey) {
        helpers.handleClearSelection();
        return;
      }

      if (key === "a" && hasCommandModifier && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        helpers.handleSelectAll();
        return;
      }

      if (key === "x" && !hasCommandModifier && !event.altKey && !event.shiftKey) {
        const hovered = document.querySelector<HTMLElement>("[data-selection-entity-id]:hover");
        const entityID = hovered?.dataset.selectionEntityId;
        const groupID = hovered?.dataset.selectionGroupId;
        if (!entityID || !groupID) return;
        event.preventDefault();
        helpers.toggleEntity(entityID, groupID);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [disabled, helpers]);
};
