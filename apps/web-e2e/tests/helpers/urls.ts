/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Dedicated e2e environment, never the dev stack (3000 / 8000):
// - API from docker-compose-e2e.yml (host port 8200), started by tests/global-setup.ts;
// - web dev server on 3200, started by playwright.config.ts and pointed at that API.
export const API_URL = "http://localhost:8200";
export const WEB_URL = "http://localhost:3200";

export function projectIssuesUrl(workspaceSlug: string, projectId: string): string {
  return `/${workspaceSlug}/projects/${projectId}/issues`;
}
