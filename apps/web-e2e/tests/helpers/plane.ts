/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { API_URL } from "./urls";

/**
 * Arrange-phase helpers that drive the real app API with the session of a throwaway user.
 *
 * They take the browser context's `request` (page.request), which shares its cookie jar with
 * the page: once `signUpFreshUser` has run, the page is logged in as that user too. Workspace,
 * project and work items go through the API rather than SQL so Plane's own defaults (default
 * states, sequence ids, memberships) apply and upstream migrations cannot break the fixtures.
 */

export type PlaneSession = {
  request: APIRequestContext;
  csrfToken: string;
  email: string;
};

export type TState = { id: string; name: string; group: string };
export type TWorkItem = {
  id: string;
  name: string;
  state_id: string;
  priority: string;
  start_date: string | null;
  target_date: string | null;
  assignee_ids: string[];
  label_ids: string[];
};

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function call<T>(
  session: PlaneSession,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown
): Promise<T> {
  const response = await session.request.fetch(`${API_URL}${path}`, {
    method,
    data,
    headers: { "X-CSRFToken": session.csrfToken },
  });
  if (!response.ok()) {
    throw new Error(`${method} ${path} failed with ${response.status()}: ${await response.text()}`);
  }
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

/**
 * Signs up a brand-new user through the real email/password flow, then marks it onboarded so
 * the web app lands on the requested page instead of the onboarding wizard. A fresh user per
 * test keeps tests independent from whatever already lives in the dev database.
 */
export async function signUpFreshUser(request: APIRequestContext): Promise<PlaneSession> {
  const csrfResponse = await request.get(`${API_URL}/auth/get-csrf-token/`);
  const { csrf_token: csrfToken } = (await csrfResponse.json()) as { csrf_token: string };

  const email = `web-e2e-${uniqueSuffix()}@example.com`;
  const signUp = await request.post(`${API_URL}/auth/sign-up/`, {
    form: { email, password: `E2e-${randomUUID()}!`, csrfmiddlewaretoken: csrfToken },
    maxRedirects: 0,
  });
  // The auth views always redirect; errors are reported as query params on the redirect URL.
  const location = signUp.headers()["location"] ?? "";
  if (signUp.status() !== 302 || location.includes("error_code")) {
    throw new Error(`Sign-up failed (${signUp.status()}): ${location}`);
  }

  const session = { request, csrfToken, email };
  await call(session, "PATCH", "/api/users/me/profile/", {
    is_onboarded: true,
    is_tour_completed: true,
    is_navigation_tour_completed: true,
    onboarding_step: { profile_complete: true, workspace_create: true, workspace_invite: true, workspace_join: true },
  });
  return session;
}

export async function createWorkspace(session: PlaneSession): Promise<{ slug: string }> {
  const slug = `e2e-${uniqueSuffix()}`;
  return call(session, "POST", "/api/workspaces/", { name: slug, slug, organization_size: "Just myself" });
}

export async function createProject(session: PlaneSession, workspaceSlug: string): Promise<{ id: string }> {
  return call(session, "POST", `/api/workspaces/${workspaceSlug}/projects/`, {
    name: "Bulk edit",
    identifier: "BULK",
    network: 2,
  });
}

export async function getStates(session: PlaneSession, workspaceSlug: string, projectId: string): Promise<TState[]> {
  return call(session, "GET", `/api/workspaces/${workspaceSlug}/projects/${projectId}/states/`);
}

export async function createWorkItem(
  session: PlaneSession,
  workspaceSlug: string,
  projectId: string,
  data: { name: string } & Partial<Pick<TWorkItem, "start_date" | "target_date" | "state_id" | "priority">>
): Promise<TWorkItem> {
  return call(session, "POST", `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/`, data);
}

export async function getWorkItem(
  session: PlaneSession,
  workspaceSlug: string,
  projectId: string,
  workItemId: string
): Promise<TWorkItem> {
  return call(session, "GET", `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${workItemId}/`);
}

export type TProjectDisplayFilters = {
  layout: "list" | "kanban" | "spreadsheet" | "gantt_chart";
  group_by?: string | null;
  sub_group_by?: string | null;
};

/** Sets the current user's layout (and grouping) for the project's work item views. */
export async function setProjectLayout(
  session: PlaneSession,
  workspaceSlug: string,
  projectId: string,
  displayFilters: TProjectDisplayFilters
): Promise<void> {
  const path = `/api/workspaces/${workspaceSlug}/projects/${projectId}/user-properties/`;
  const current = await call<{ display_filters?: Record<string, unknown> }>(session, "GET", path);
  await call(session, "PATCH", path, { display_filters: { ...current.display_filters, ...displayFilters } });
}
