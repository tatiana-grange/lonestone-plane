/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { ModuleIcon, SuspendedUserIcon } from "@plane/propel/icons";
import type { IIssueLabel, IModule, IUserLite } from "@plane/types";
import { Avatar } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";
import type { TBulkTriStateOption } from "./tri-state-menu";

// Same rendering as the options of the upstream dropdowns (`MemberOptions`, `LabelDropdown`, `ModuleOptions`).
// Kept here rather than exported from `core/` so that those files stay untouched.

/** Assignee options: suspended members are disabled. */
export const useMemberOptions = (
  memberIds: string[] | undefined,
  getUserDetails: (userId: string) => IUserLite | undefined
): TBulkTriStateOption[] => {
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const { data: currentUser } = useUser();
  const {
    workspace: { isUserSuspended },
  } = useMember();

  return (memberIds ?? []).map((userId) => {
    const userDetails = getUserDetails(userId);
    const isSuspended = isUserSuspended(userId, workspaceSlug?.toString());
    return {
      value: userId,
      query: `${userDetails?.display_name} ${userDetails?.first_name} ${userDetails?.last_name}`,
      disabled: isSuspended,
      content: (
        <div className="flex items-center gap-2">
          <div className="w-4">
            {isSuspended ? (
              <SuspendedUserIcon className="h-3.5 w-3.5 text-placeholder" />
            ) : (
              <Avatar name={userDetails?.display_name} src={getFileURL(userDetails?.avatar_url ?? "")} />
            )}
          </div>
          <span className={cn("grow truncate", isSuspended ? "text-placeholder" : "")}>
            {currentUser?.id === userId ? t("you") : userDetails?.display_name}
          </span>
        </div>
      ),
    };
  });
};

export const getLabelOptions = (labels: IIssueLabel[]): TBulkTriStateOption[] =>
  labels.map((label) => ({
    value: label.id,
    query: label.name,
    content: (
      <div className="flex items-center justify-start gap-2 overflow-hidden">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
        <div className="line-clamp-1 inline-block truncate">{label.name}</div>
      </div>
    ),
  }));

export const getModuleOptions = (
  moduleIds: string[] | undefined,
  getModuleById: (moduleId: string) => IModule | null
): TBulkTriStateOption[] =>
  (moduleIds ?? []).map((moduleId) => {
    const moduleDetails = getModuleById(moduleId);
    return {
      value: moduleId,
      query: `${moduleDetails?.name}`,
      content: (
        <div className="flex items-center gap-2">
          <ModuleIcon className="h-3 w-3 shrink-0" />
          <span className="grow truncate">{moduleDetails?.name}</span>
        </div>
      ),
    };
  });
