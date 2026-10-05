/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Page } from "@playwright/test";
import type { ProjectFixture } from "./fixtures";
import { expect, test } from "./fixtures";
import type { TWorkItem } from "./helpers/plane";
import { createWorkItem, getWorkItem } from "./helpers/plane";
import { projectIssuesUrl } from "./helpers/urls";

function toPayloadDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function createWorkItems(project: ProjectFixture, names: string[]): Promise<TWorkItem[]> {
  const items = [];
  for (const name of names) {
    // sequential on purpose: keeps sequence ids (and list order) deterministic
    // oxlint-disable-next-line no-await-in-loop
    items.push(await createWorkItem(project.session, project.workspaceSlug, project.projectId, { name }));
  }
  return items;
}

async function openIssueList(page: Page, project: ProjectFixture): Promise<void> {
  await page.goto(projectIssuesUrl(project.workspaceSlug, project.projectId));
}

/** Row checkboxes only become clickable while the row is hovered. */
/** Dropdown triggers wrap their label button in the combobox button: target the outer one. */
function barDropdown(page: Page, label: string) {
  return page.getByTestId("bulk-operations-bar").getByRole("button", { name: label, exact: true }).first();
}

async function selectWorkItems(page: Page, items: TWorkItem[]): Promise<void> {
  for (const item of items) {
    // oxlint-disable-next-line no-await-in-loop
    await page.getByText(item.name, { exact: true }).hover();
    // oxlint-disable-next-line no-await-in-loop
    await page.locator(`[data-entity-id="${item.id}"]`).click();
  }
}

test.describe("bulk edit work items (list layout)", () => {
  test("changes the state of every selected work item and keeps the selection", async ({ page, project }) => {
    const items = await createWorkItems(project, ["Ship the API", "Ship the bar", "Ship the docs"]);
    const inProgress = project.states.find((state) => state.name === "In Progress");
    expect(inProgress).toBeDefined();

    await openIssueList(page, project);
    await selectWorkItems(page, items);

    const bar = page.getByTestId("bulk-operations-bar");
    await expect(bar).toContainText("3 selected");

    await barDropdown(page, "State").click();
    await page.getByRole("option", { name: "In Progress" }).click();

    await expect(page.getByText("3 work items updated")).toBeVisible();
    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      const updated = await getWorkItem(project.session, project.workspaceSlug, project.projectId, item.id);
      expect(updated.state_id).toBe(inProgress?.id);
    }
    // FR-014: the selection survives the update so another property can be applied.
    await expect(bar).toContainText("3 selected");
  });

  test("Escape clears the selection and hides the bar", async ({ page, project }) => {
    const items = await createWorkItems(project, ["First", "Second"]);

    await openIssueList(page, project);
    await selectWorkItems(page, items);
    const bar = page.getByTestId("bulk-operations-bar");
    await expect(bar).toContainText("2 selected");

    await page.keyboard.press("Escape");

    await expect(bar).toBeHidden();
  });

  test("reports work items whose dates would become inconsistent", async ({ page, project }) => {
    const today = new Date();
    const firstOfMonth = toPayloadDate(new Date(today.getFullYear(), today.getMonth(), 1));
    const lastOfMonth = toPayloadDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));

    // Starts at the end of the month: a due date on the 1st would end before it starts.
    const lateStart = await createWorkItem(project.session, project.workspaceSlug, project.projectId, {
      name: "Starts late",
      start_date: lastOfMonth,
    });
    const others = await createWorkItems(project, ["Fine A", "Fine B"]);

    await openIssueList(page, project);
    await selectWorkItems(page, [lateStart, ...others]);

    await expect(page.getByTestId("bulk-operations-bar")).toContainText("3 selected");
    await barDropdown(page, "Due date").click();
    // The calendar opens on the current month; react-day-picker tags each day cell.
    await page.locator(`[data-day="${firstOfMonth}"]`).click();

    const toast = page.getByText("2 updated, 1 not updated");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("1 with start date after due date");

    const lateAfter = await getWorkItem(project.session, project.workspaceSlug, project.projectId, lateStart.id);
    expect(lateAfter.target_date).toBeNull();
    for (const item of others) {
      // oxlint-disable-next-line no-await-in-loop
      const updated = await getWorkItem(project.session, project.workspaceSlug, project.projectId, item.id);
      expect(updated.target_date).toBe(firstOfMonth);
    }
  });
});
