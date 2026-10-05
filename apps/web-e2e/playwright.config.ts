/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { defineConfig } from "@playwright/test";
import { API_URL, WEB_URL } from "./tests/helpers/urls";

const WEB_PORT = new URL(WEB_URL).port;

// Runs against a dedicated environment (see README.md): the backend is started by
// tests/global-setup.ts, the web dev server below. Neither touches the dev stack.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  // Tests are independent (each one signs up its own user, workspace and project) but share
  // one API: running serially keeps failures readable and the machine responsive.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm --filter=web exec react-router dev --port ${WEB_PORT} --strictPort`,
    cwd: "../..",
    url: WEB_URL,
    // Its own port, so it never reuses the dev server (which talks to the dev API).
    reuseExistingServer: true,
    // The first Vite build of the web app takes a while.
    timeout: 240_000,
    // Process env wins over apps/web/.env (vite.config.ts loads it with dotenv).
    env: {
      VITE_API_BASE_URL: API_URL,
      VITE_WEB_BASE_URL: WEB_URL,
    },
  },
});
