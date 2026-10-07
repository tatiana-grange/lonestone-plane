/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

/**
 * Keeps a selected entity selected when it moves to another group (e.g. a state change on a board),
 * by recording the group it is now displayed in. Entities no longer displayed at all are dropped
 * by `useMultipleSelect` itself.
 */
export const useFollowSelectedEntityGroup = (params: { helpers: TSelectionHelper; disabled: boolean }) => {
  const { helpers, disabled } = params;
  const { selectedEntityIds, getEntityDetailsFromEntityID, updateSelectedEntityGroup } = useMultipleSelectStore();
  const { entitiesList } = helpers;

  useEffect(() => {
    if (disabled) return;
    selectedEntityIds.forEach((entityID) => {
      const entityDetails = getEntityDetailsFromEntityID(entityID);
      // an entity can show in several groups (e.g. a board grouped by labels)
      const presentEntities = entitiesList.filter((entity) => entity?.entityID === entityID);
      if (!entityDetails || presentEntities.length === 0) return;
      if (!presentEntities.some((entity) => entity.groupID === entityDetails.groupID)) {
        updateSelectedEntityGroup(entityID, presentEntities[0].groupID);
      }
    });
  }, [disabled, entitiesList, getEntityDetailsFromEntityID, selectedEntityIds, updateSelectedEntityGroup]);
};
