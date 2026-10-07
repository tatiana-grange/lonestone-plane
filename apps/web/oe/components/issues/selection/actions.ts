/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TEntityDetails, TSelectionHelper } from "@/hooks/use-multiple-select";

type TSelectionStatus = "empty" | "partial" | "complete";

const getGroupsEntities = (helpers: TSelectionHelper, groupIDs: string[]): TEntityDetails[] => {
  const groupIDSet = new Set(groupIDs);
  return helpers.entitiesList.filter((entity) => groupIDSet.has(entity?.groupID));
};

/** Toggles a single entity, without range or scroll (Cmd/Ctrl + click, X, long press). */
export const toggleEntity = (helpers: TSelectionHelper, entityID: string, groupID: string) =>
  helpers.handleEntitySelection({ entityID, groupID }, false);

/** Selects every displayed entity (Cmd/Ctrl + A). */
export const selectAllEntities = (helpers: TSelectionHelper) =>
  helpers.handleEntitySelection(helpers.entitiesList, false, "force-add");

/** Selection status of the union of several groups (e.g. a board column split in swimlanes). */
export const getGroupsSelectionStatus = (helpers: TSelectionHelper, groupIDs: string[]): TSelectionStatus => {
  const groupEntities = getGroupsEntities(helpers, groupIDs);
  const totalSelected = groupEntities.filter((entity) => helpers.getIsEntitySelected(entity.entityID)).length;
  if (totalSelected === 0) return "empty";
  if (totalSelected === groupEntities.length) return "complete";
  return "partial";
};

/** Selects every entity of the groups when none is selected, unselects them otherwise. */
export const toggleGroupsSelection = (helpers: TSelectionHelper, groupIDs: string[]) => {
  const status = getGroupsSelectionStatus(helpers, groupIDs);
  helpers.handleEntitySelection(
    getGroupsEntities(helpers, groupIDs),
    false,
    status === "empty" ? "force-add" : "force-remove"
  );
};
