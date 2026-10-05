/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import process from "node:process";
import { request } from "@playwright/test";
import { DockerComposeEnvironment, Wait } from "testcontainers";
import { API_URL } from "./helpers/urls";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * Starts the dedicated backend (docker-compose-e2e.yml) with testcontainers and configures
 * its Plane instance, so every run gets an empty, freshly migrated database that has nothing
 * to do with the dev stack. Returns the teardown that removes the whole stack.
 *
 * Set E2E_KEEP_STACK=1 to leave it running after the run (debugging, `test:e2e:ui`); the next
 * run reuses it.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const environment = await new DockerComposeEnvironment(REPO_ROOT, "docker-compose-e2e.yml")
    .withProjectName("plane-e2e")
    .withBuild()
    // Migrating an empty database takes a while on the first run.
    .withStartupTimeout(10 * 60_000)
    .withWaitStrategy("e2e-api-1", Wait.forHealthCheck())
    .up();

  await setUpInstance();

  return async () => {
    if (process.env.E2E_KEEP_STACK) return;
    await environment.down({ removeVolumes: true });
  };
}

/**
 * Same as the god-mode first-run screen: creating the instance admin marks the instance as
 * set up, which the app requires before anyone can sign up or sign in.
 */
async function setUpInstance(): Promise<void> {
  const api = await request.newContext({ baseURL: API_URL });
  try {
    const instance = (await (await api.get("/api/instances/")).json()) as { instance?: { is_setup_done?: boolean } };
    if (instance.instance?.is_setup_done) return;

    const { csrf_token: csrfToken } = (await (await api.get("/auth/get-csrf-token/")).json()) as {
      csrf_token: string;
    };
    const response = await api.post("/api/instances/admins/sign-up/", {
      form: {
        email: "admin@e2e.plane.local",
        password: `E2e-${randomUUID()}!`,
        first_name: "E2E",
        company_name: "Plane e2e",
        is_telemetry_enabled: "False",
        csrfmiddlewaretoken: csrfToken,
      },
      maxRedirects: 0,
    });
    // The auth views always redirect; errors are reported as query params on the redirect URL.
    const location = response.headers()["location"] ?? "";
    if (response.status() !== 302 || location.includes("error_code")) {
      throw new Error(`Instance admin sign-up failed (${response.status()}): ${location}`);
    }
  } finally {
    await api.dispose();
  }
}
