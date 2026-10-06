/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// hooks
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { useMultipleSelect } from "@/hooks/use-multiple-select";
// plane web hooks
import { useClearSelectionOnBackgroundClick } from "@/plane-web/hooks/use-clear-selection-on-background-click";
import { useSelectionShortcuts } from "@/plane-web/hooks/use-selection-shortcuts";

type Props = {
  children: (helpers: TSelectionHelper) => React.ReactNode;
  containerRef: React.MutableRefObject<HTMLElement | null>;
  disabled?: boolean;
  entities: Record<string, string[]>; // { groupID: entityIds[] }
  rangeScope?: "all" | "group";
};

export const MultipleSelectGroup = observer(function MultipleSelectGroup(props: Props) {
  const { children, containerRef, disabled = false, entities, rangeScope } = props;

  const helpers = useMultipleSelect({
    containerRef,
    disabled,
    entities,
    rangeScope,
  });
  useSelectionShortcuts({ helpers, disabled });
  useClearSelectionOnBackgroundClick({ containerRef, helpers, disabled });

  return <>{children(helpers)}</>;
});
