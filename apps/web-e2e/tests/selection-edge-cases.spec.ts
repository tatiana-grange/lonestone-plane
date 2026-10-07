/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Locator, Page } from "@playwright/test";
import type { ProjectFixture } from "./fixtures";
import { expect, test } from "./fixtures";
import type { TWorkItem } from "./helpers/plane";
import {
  addModuleWorkItems,
  createLabel,
  createModule,
  createWorkItem,
  getWorkItem,
  setProjectLayout,
  updateWorkItem,
} from "./helpers/plane";
import { moduleIssuesUrl, projectIssuesUrl } from "./helpers/urls";

async function createWorkItems(project: ProjectFixture, names: string[]): Promise<TWorkItem[]> {
  const items: TWorkItem[] = [];
  for (const name of names) {
    // sequential on purpose: keeps sequence ids (and order) deterministic
    // oxlint-disable-next-line no-await-in-loop
    items.push(await createWorkItem(project.session, project.workspaceSlug, project.projectId, { name }));
  }
  return items;
}

async function setLabels(project: ProjectFixture, item: TWorkItem, labelIds: string[]): Promise<void> {
  await updateWorkItem(project.session, project.workspaceSlug, project.projectId, item.id, { label_ids: labelIds });
}

/** The occurrence of a work item displayed in a given group (a work item can show in several label columns). */
function cardIn(page: Page, item: TWorkItem, groupId: string): Locator {
  return page.locator(`[data-selection-entity-id="${item.id}"][data-selection-group-id="${groupId}"]`);
}

async function clickCardIn(
  page: Page,
  item: TWorkItem,
  groupId: string,
  modifiers: ("ControlOrMeta" | "Shift")[] = []
): Promise<void> {
  await cardIn(page, item, groupId).getByText(item.name, { exact: true }).click({ modifiers });
}

function bar(page: Page): Locator {
  return page.getByTestId("bulk-operations-bar");
}

/** Opens the project board grouped by labels. */
async function openLabelBoard(page: Page, project: ProjectFixture, firstVisible: TWorkItem): Promise<void> {
  await setProjectLayout(project.session, project.workspaceSlug, project.projectId, {
    layout: "kanban",
    group_by: "labels",
    sub_group_by: null,
  });
  await page.goto(projectIssuesUrl(project.workspaceSlug, project.projectId));
  // the first load of a board fetches every column separately
  await expect(page.locator(`[data-selection-entity-id="${firstVisible.id}"]`).first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("selection of work items shown in several groups", () => {
  test("Shift + click selects a range in the column of a card that also shows in another column", async ({
    page,
    project,
  }) => {
    const alpha = await createLabel(project.session, project.workspaceSlug, project.projectId, "Alpha");
    const bravo = await createLabel(project.session, project.workspaceSlug, project.projectId, "Bravo");
    const shared = (await createWorkItems(project, ["Shared"]))[0];
    const alphaItems = await createWorkItems(project, ["Alpha 1", "Alpha 2", "Alpha 3"]);
    const bravoItems = await createWorkItems(project, ["Bravo 1", "Bravo 2", "Bravo 3"]);
    // "Shared" shows in both columns, three other cards in each
    await setLabels(project, shared, [alpha.id, bravo.id]);
    for (const item of alphaItems) {
      // oxlint-disable-next-line no-await-in-loop
      await setLabels(project, item, [alpha.id]);
    }
    for (const item of bravoItems) {
      // oxlint-disable-next-line no-await-in-loop
      await setLabels(project, item, [bravo.id]);
    }
    await openLabelBoard(page, project, shared);

    // Both columns are tried: the selection keeps groups in store order, not in screen order, so only one of
    // them holds the card's first occurrence and we cannot tell which one from the screen.
    const columns = [
      { groupId: alpha.id, others: alphaItems },
      { groupId: bravo.id, others: bravoItems },
    ];
    for (const { groupId, others } of columns) {
      // that column, top to bottom
      // oxlint-disable-next-line no-await-in-loop
      const column = await Promise.all(
        [shared, ...others].map(async (item) => ({
          item,
          y: (await cardIn(page, item, groupId).boundingBox())?.y ?? 0,
        }))
      );
      column.sort((a, b) => a.y - b.y);
      const anchorIndex = column.findIndex(({ item }) => item.id === shared.id);
      // the far end of the column from "Shared": at least two cards away with four cards
      const targetIndex = anchorIndex < column.length / 2 ? column.length - 1 : 0;

      // oxlint-disable-next-line no-await-in-loop
      await clickCardIn(page, shared, groupId, ["ControlOrMeta"]);
      // oxlint-disable-next-line no-await-in-loop
      await expect(bar(page)).toContainText("1 selected");
      // oxlint-disable-next-line no-await-in-loop
      await clickCardIn(page, column[targetIndex].item, groupId, ["Shift"]);

      // oxlint-disable-next-line no-await-in-loop
      await expect(bar(page)).toContainText(`${Math.abs(targetIndex - anchorIndex) + 1} selected`);
      // oxlint-disable-next-line no-await-in-loop
      await page.keyboard.press("Escape");
      // oxlint-disable-next-line no-await-in-loop
      await expect(bar(page)).toBeHidden();
    }
  });

  test("Cmd/Ctrl + A counts a work item shown in two columns once", async ({ page, project }) => {
    const alpha = await createLabel(project.session, project.workspaceSlug, project.projectId, "Alpha");
    const bravo = await createLabel(project.session, project.workspaceSlug, project.projectId, "Bravo");
    const items = await createWorkItems(project, ["Shared", "Alpha only"]);
    await setLabels(project, items[0], [alpha.id, bravo.id]);
    await setLabels(project, items[1], [alpha.id]);
    await openLabelBoard(page, project, items[1]);
    await expect(cardIn(page, items[0], bravo.id)).toBeVisible();

    await page.keyboard.press("ControlOrMeta+a");

    await expect(bar(page)).toContainText("2 selected");
  });

  test("column checkboxes count a work item shown in two columns once", async ({ page, project }) => {
    const alpha = await createLabel(project.session, project.workspaceSlug, project.projectId, "Alpha");
    const bravo = await createLabel(project.session, project.workspaceSlug, project.projectId, "Bravo");
    const items = await createWorkItems(project, ["Shared", "Alpha only"]);
    await setLabels(project, items[0], [alpha.id, bravo.id]);
    await setLabels(project, items[1], [alpha.id]);
    await openLabelBoard(page, project, items[1]);

    await page.getByRole("checkbox", { name: "Select all in Alpha" }).click();

    await expect(bar(page)).toContainText("2 selected");
    await expect(page.getByRole("checkbox", { name: "Select all in Bravo" })).toBeChecked();
  });
});

test.describe("bulk module removal in the module view", () => {
  test("removing the current module drops the work items from the module view", async ({ page, project }) => {
    const items = await createWorkItems(project, ["Removed A", "Removed B", "Kept"]);
    const module = await createModule(project.session, project.workspaceSlug, project.projectId, "Paiement");
    await addModuleWorkItems(
      project.session,
      project.workspaceSlug,
      project.projectId,
      module.id,
      items.map((item) => item.id)
    );
    const row = (item: TWorkItem) => page.locator(`[data-selection-entity-id="${item.id}"]`).first();

    // the module sidebar would cover the bulk operations bar
    await page.addInitScript(() => window.localStorage.setItem("module_sidebar_collapsed", JSON.stringify("true")));
    await page.goto(moduleIssuesUrl(project.workspaceSlug, project.projectId, module.id));
    await expect(row(items[0])).toBeVisible({ timeout: 30_000 });
    for (const item of items.slice(0, 2)) {
      // oxlint-disable-next-line no-await-in-loop
      await row(item)
        .getByText(item.name, { exact: true })
        .click({ modifiers: ["ControlOrMeta"] });
    }
    await expect(bar(page)).toContainText("2 selected");

    await bar(page).getByRole("button", { name: "Modules" }).click();
    const paiement = page.getByTestId("bulk-tri-state-menu").getByRole("menuitemcheckbox", { name: /Paiement/ });
    await expect(paiement).toHaveAttribute("aria-checked", "true");
    await paiement.click();
    await expect(paiement).toHaveAttribute("aria-checked", "false");

    // the server side is done...
    for (const item of items.slice(0, 2)) {
      // oxlint-disable-next-line no-await-in-loop
      const workItem = await getWorkItem(project.session, project.workspaceSlug, project.projectId, item.id);
      expect(workItem.module_ids ?? []).not.toContain(module.id);
    }
    // ...and the module view follows without a reload
    await page.keyboard.press("Escape");
    await expect(row(items[0])).toBeHidden();
    await expect(row(items[1])).toBeHidden();
    await expect(row(items[2])).toBeVisible();
  });
});

test.describe("Escape with the peek overview open", () => {
  test("the first Escape closes the peek overview and keeps the selection", async ({ page, project }) => {
    const items = await createWorkItems(project, ["Selected", "Opened"]);
    await setProjectLayout(project.session, project.workspaceSlug, project.projectId, {
      layout: "list",
      group_by: null,
      sub_group_by: null,
    });
    const title = (item: TWorkItem) =>
      page.locator(`[data-selection-entity-id="${item.id}"]`).getByText(item.name, { exact: true });
    const peek = page.getByTestId("issue-peek-overview");

    await page.goto(projectIssuesUrl(project.workspaceSlug, project.projectId));
    await title(items[0]).click({ modifiers: ["ControlOrMeta"] });
    await title(items[1]).click();
    await expect(peek).toBeVisible();
    await expect(bar(page)).toContainText("1 selected");
    // keyboard focus outside any field of the peek overview
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.press("Escape");
    await expect(peek).toBeHidden();
    await expect(bar(page)).toContainText("1 selected");

    await page.keyboard.press("Escape");
    await expect(bar(page)).toBeHidden();
  });
});

test.describe("timelines without work items", () => {
  test("Cmd/Ctrl + A on the modules timeline does not open the work item bulk bar", async ({ page, project }) => {
    const modules = [
      await createModule(project.session, project.workspaceSlug, project.projectId, "Module one"),
      await createModule(project.session, project.workspaceSlug, project.projectId, "Module two"),
    ];
    // the modules page keeps its layout in local storage, per project
    await page.addInitScript((projectId) => {
      window.localStorage.setItem("module_display_filters", JSON.stringify({ [projectId]: { layout: "gantt" } }));
    }, project.projectId);

    await page.goto(`/${project.workspaceSlug}/projects/${project.projectId}/modules`);
    await expect(page.locator("#gantt-container")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(modules[0].name, { exact: true }).first()).toBeVisible();
    await page.getByText(modules[0].name, { exact: true }).first().hover();

    await page.keyboard.press("ControlOrMeta+a");

    await expect(bar(page)).toBeHidden();
  });
});

test.describe("module progress after a bulk change", () => {
  test("a bulk state change updates the module progress without a reload", async ({ page, project }) => {
    const items = await createWorkItems(project, ["Progress A", "Progress B"]);
    const module = await createModule(project.session, project.workspaceSlug, project.projectId, "Livraison");
    await addModuleWorkItems(
      project.session,
      project.workspaceSlug,
      project.projectId,
      module.id,
      items.map((item) => item.id)
    );
    const row = (item: TWorkItem) => page.locator(`[data-selection-entity-id="${item.id}"]`).first();

    // the module sidebar would cover the bulk operations bar: it is opened once the change is done
    await page.addInitScript(() => window.localStorage.setItem("module_sidebar_collapsed", JSON.stringify("true")));
    await page.goto(moduleIssuesUrl(project.workspaceSlug, project.projectId, module.id));
    await expect(row(items[0])).toBeVisible({ timeout: 30_000 });
    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      await row(item)
        .getByText(item.name, { exact: true })
        .click({ modifiers: ["ControlOrMeta"] });
    }
    await expect(bar(page)).toContainText("2 selected");

    await bar(page).getByRole("button", { name: "State", exact: true }).first().click();
    await page.getByRole("option", { name: "Done" }).click();
    await expect(page.getByText("2 work items updated")).toBeVisible();

    await page.locator("button:has(svg.lucide-panel-right)").click();
    await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  });
});
