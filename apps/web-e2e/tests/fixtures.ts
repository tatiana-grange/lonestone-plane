/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { test as base } from "@playwright/test";
import type { PlaneSession, TState } from "./helpers/plane";
import { createProject, createWorkspace, getStates, signUpFreshUser } from "./helpers/plane";

export type ProjectFixture = {
  session: PlaneSession;
  workspaceSlug: string;
  projectId: string;
  states: TState[];
};

/**
 * `project`: a fresh user (logged in in the page) owning a fresh workspace and project with
 * Plane's default states. Nothing is shared between tests.
 */
export const test = base.extend<{ project: ProjectFixture }>({
  project: async ({ page }, use) => {
    const session = await signUpFreshUser(page.request);
    const { slug: workspaceSlug } = await createWorkspace(session);
    const { id: projectId } = await createProject(session, workspaceSlug);
    const states = await getStates(session, workspaceSlug, projectId);
    await use({ session, workspaceSlug, projectId, states });
  },
});

export { expect } from "@playwright/test";
