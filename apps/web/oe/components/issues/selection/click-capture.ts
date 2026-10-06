/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MouseEvent } from "react";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

/**
 * `onClickCapture` handler that turns Cmd/Ctrl + click on a work item into a selection toggle, and
 * Shift + click into a range selection.
 *
 * It runs in the capture phase, on the element wrapping the item's `ControlLink`: the link would
 * otherwise open the work item in a new tab (native Cmd/Ctrl + click on an anchor). Middle click
 * and the browser context menu still open a new tab. Returns `undefined` when selection is not
 * available, so the native behaviour is kept there.
 */
export const getSelectionClickCaptureHandler = (
  helpers: TSelectionHelper | undefined,
  entityID: string,
  groupID: string
): ((event: MouseEvent) => void) | undefined => {
  if (!helpers || helpers.isSelectionDisabled) return undefined;

  return (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      helpers.toggleEntity(entityID, groupID);
      return;
    }
    if (event.shiftKey) {
      // shift + click extends the selection from the last selected item (range rules of the hook)
      event.preventDefault();
      event.stopPropagation();
      helpers.handleEntityClick(event, entityID, groupID);
    }
  };
};
