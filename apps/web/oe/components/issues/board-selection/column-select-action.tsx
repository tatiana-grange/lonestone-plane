/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { Checkbox } from "@plane/ui";
import { cn } from "@plane/utils";
import { getGroupsSelectionStatus, toggleGroupsSelection } from "@/plane-web/components/issues/selection/actions";
import { useBoardColumnGroupIds, useBoardSelection } from "./context";

type Props = {
  columnId: string;
  columnTitle: string;
  className?: string;
};

/** "Select all" checkbox of a board column; covers every swimlane of the column when sub-grouped. */
export const BoardColumnSelectAction = observer(function BoardColumnSelectAction(props: Props) {
  const { columnId, columnTitle, className } = props;
  const { t } = useTranslation();
  const helpers = useBoardSelection();
  const groupIds = useBoardColumnGroupIds(columnId);

  if (!helpers || helpers.isSelectionDisabled || groupIds.length === 0) return null;

  const status = getGroupsSelectionStatus(helpers, groupIds);

  return (
    <span className={cn("grid size-6 flex-shrink-0 place-items-center", className)}>
      <Checkbox
        className="size-3.5 focus-visible:ring-2 focus-visible:ring-accent-strong"
        iconClassName="size-3"
        checked={status === "complete"}
        indeterminate={status === "partial"}
        aria-label={t("bulk_operations.select_column", { column: columnTitle })}
        readOnly
        onClick={(event) => {
          event.stopPropagation();
          toggleGroupsSelection(helpers, groupIds);
        }}
      />
    </span>
  );
});
