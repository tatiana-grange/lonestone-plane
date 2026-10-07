/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import { MultipleSelectEntityAction } from "@/components/core/multiple-select";
import { useBoardSelection } from "./context";

type Props = {
  issueId: string;
  groupId: string;
  identifier: string;
  className?: string;
};

/** Card checkbox: revealed on hover or keyboard focus, always visible once selected, hidden on touch screens. */
export const BoardCardSelectAction = observer(function BoardCardSelectAction(props: Props) {
  const { issueId, groupId, identifier, className } = props;
  const { t } = useTranslation();
  const helpers = useBoardSelection();

  if (!helpers || helpers.isSelectionDisabled) return null;

  const isSelected = helpers.getIsEntitySelected(issueId);

  return (
    <span
      className={cn(
        "grid size-6 place-items-center rounded-sm bg-layer-2 opacity-0 transition-opacity group-hover/kanban-block:opacity-100 focus-within:opacity-100 [@media(hover:none)]:hidden",
        { "opacity-100": isSelected },
        className
      )}
    >
      <MultipleSelectEntityAction
        className="focus-visible:ring-2 focus-visible:ring-accent-strong"
        id={issueId}
        groupId={groupId}
        selectionHelpers={helpers}
        aria-label={t("bulk_operations.select_item", { identifier })}
      />
    </span>
  );
});
