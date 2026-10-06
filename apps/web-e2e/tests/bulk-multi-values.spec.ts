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
  addProjectMember,
  createLabel,
  createModule,
  createWorkItem,
  deleteWorkItem,
  getCurrentUser,
  getWorkItem,
  setProjectLayout,
  updateWorkItem,
} from "./helpers/plane";
import { projectIssuesUrl } from "./helpers/urls";

async function createWorkItems(project: ProjectFixture, names: string[]): Promise<TWorkItem[]> {
  const items: TWorkItem[] = [];
  for (const name of names) {
    // sequential on purpose: keeps sequence ids (and order) deterministic
    // oxlint-disable-next-line no-await-in-loop
    items.push(await createWorkItem(project.session, project.workspaceSlug, project.projectId, { name }));
  }
  return items;
}

/** Opens the list layout and selects every given work item with Cmd/Ctrl + click. */
async function openAndSelect(page: Page, project: ProjectFixture, items: TWorkItem[]): Promise<void> {
  await setProjectLayout(project.session, project.workspaceSlug, project.projectId, {
    layout: "list",
    group_by: null,
    sub_group_by: null,
  });
  await page.goto(projectIssuesUrl(project.workspaceSlug, project.projectId));
  for (const item of items) {
    // oxlint-disable-next-line no-await-in-loop
    await page
      .locator(`[data-selection-entity-id="${item.id}"]`)
      .getByText(item.name, { exact: true })
      .click({ modifiers: ["ControlOrMeta"] });
  }
  await expect(bar(page)).toContainText(`${items.length} selected`);
}

function bar(page: Page): Locator {
  return page.getByTestId("bulk-operations-bar");
}

function menu(page: Page): Locator {
  return page.getByTestId("bulk-tri-state-menu");
}

function menuItem(page: Page, name: string): Locator {
  return menu(page).getByRole("menuitemcheckbox", { name: new RegExp(name) });
}

async function assigneesOf(project: ProjectFixture, item: TWorkItem): Promise<string[]> {
  const workItem = await getWorkItem(project.session, project.workspaceSlug, project.projectId, item.id);
  return [...workItem.assignee_ids].toSorted();
}

test.describe("bulk assignees", () => {
  test("shows each member's state, removes from all and reassigns", async ({ page, browser, project }) => {
    const owner = await getCurrentUser(project.session);
    const memberContext = await browser.newContext();
    const second = await addProjectMember(
      project.session,
      memberContext.request,
      project.workspaceSlug,
      project.projectId
    );
    const items = await createWorkItems(project, ["Alpha", "Bravo", "Charlie"]);
    await updateWorkItem(project.session, project.workspaceSlug, project.projectId, items[0].id, {
      assignee_ids: [owner.id, second.id],
    });
    for (const item of items.slice(1)) {
      // oxlint-disable-next-line no-await-in-loop
      await updateWorkItem(project.session, project.workspaceSlug, project.projectId, item.id, {
        assignee_ids: [owner.id],
      });
    }

    await openAndSelect(page, project, items);
    await bar(page).getByRole("button", { name: "Assignees" }).click();

    // owner on every work item, second member on one of them
    await expect(menuItem(page, owner.displayName)).toHaveAttribute("aria-checked", "true");
    await expect(menuItem(page, second.displayName)).toHaveAttribute("aria-checked", "mixed");

    // reassign: remove the owner from all, then add the second member to all
    await menuItem(page, owner.displayName).click();
    await expect(menuItem(page, owner.displayName)).toHaveAttribute("aria-checked", "false");
    await expect(menu(page)).toBeVisible();
    await menuItem(page, second.displayName).click();
    await expect(menuItem(page, second.displayName)).toHaveAttribute("aria-checked", "true");

    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      expect(await assigneesOf(project, item)).toEqual([second.id]);
    }
    await memberContext.close();
  });

  test("Escape closes the menu and keeps the selection", async ({ page, project }) => {
    const items = await createWorkItems(project, ["Delta", "Echo"]);

    await openAndSelect(page, project, items);
    await bar(page).getByRole("button", { name: "Assignees" }).click();
    await expect(menu(page)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(menu(page)).toBeHidden();
    await expect(bar(page)).toContainText("2 selected");
  });
});

test.describe("bulk labels and modules", () => {
  test("labels: shows states and removes a label from every work item", async ({ page, project }) => {
    const items = await createWorkItems(project, ["Foxtrot", "Golf", "Hotel"]);
    const front = await createLabel(project.session, project.workspaceSlug, project.projectId, "Front");
    const urgent = await createLabel(project.session, project.workspaceSlug, project.projectId, "Urgent");
    await updateWorkItem(project.session, project.workspaceSlug, project.projectId, items[0].id, {
      label_ids: [front.id, urgent.id],
    });
    for (const item of items.slice(1)) {
      // oxlint-disable-next-line no-await-in-loop
      await updateWorkItem(project.session, project.workspaceSlug, project.projectId, item.id, {
        label_ids: [front.id],
      });
    }

    await openAndSelect(page, project, items);
    await bar(page).getByRole("button", { name: "Labels" }).click();
    await expect(menuItem(page, "Front")).toHaveAttribute("aria-checked", "true");
    await expect(menuItem(page, "Urgent")).toHaveAttribute("aria-checked", "mixed");

    await menuItem(page, "Front").click();
    await expect(menuItem(page, "Front")).toHaveAttribute("aria-checked", "false");

    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      const workItem = await getWorkItem(project.session, project.workspaceSlug, project.projectId, item.id);
      expect(workItem.label_ids).not.toContain(front.id);
    }
    const first = await getWorkItem(project.session, project.workspaceSlug, project.projectId, items[0].id);
    expect(first.label_ids).toContain(urgent.id);
  });

  test("modules: a partial module is added to all, then removed from all", async ({ page, project }) => {
    const items = await createWorkItems(project, ["India", "Juliett", "Kilo"]);
    const payment = await createModule(project.session, project.workspaceSlug, project.projectId, "Paiement");
    await addModuleWorkItems(project.session, project.workspaceSlug, project.projectId, payment.id, [items[0].id]);

    await openAndSelect(page, project, items);
    await bar(page).getByRole("button", { name: "Module" }).click();
    await expect(menuItem(page, "Paiement")).toHaveAttribute("aria-checked", "mixed");

    await menuItem(page, "Paiement").click();
    await expect(menuItem(page, "Paiement")).toHaveAttribute("aria-checked", "true");
    await menuItem(page, "Paiement").click();
    await expect(menuItem(page, "Paiement")).toHaveAttribute("aria-checked", "false");

    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      const workItem = await getWorkItem(project.session, project.workspaceSlug, project.projectId, item.id);
      expect(workItem.module_ids ?? []).not.toContain(payment.id);
    }
  });
});

test.describe("bulk removal feedback", () => {
  test("a work item deleted meanwhile is reported, the others are updated", async ({ page, project }) => {
    const items = await createWorkItems(project, ["Lima", "Mike", "November"]);
    const front = await createLabel(project.session, project.workspaceSlug, project.projectId, "Front");
    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      await updateWorkItem(project.session, project.workspaceSlug, project.projectId, item.id, {
        label_ids: [front.id],
      });
    }

    await openAndSelect(page, project, items);
    // someone else deletes one of the selected work items
    await deleteWorkItem(project.session, project.workspaceSlug, project.projectId, items[2].id);
    await bar(page).getByRole("button", { name: "Labels" }).click();
    await menuItem(page, "Front").click();

    // Either the server reports the deleted item, or the view already refreshed and dropped it from
    // the selection: both are correct outcomes, the remaining items must be updated either way.
    await expect(page.getByText("1 no longer available").or(page.getByText(/work items? updated/))).toBeVisible();
    for (const item of items.slice(0, 2)) {
      // oxlint-disable-next-line no-await-in-loop
      const workItem = await getWorkItem(project.session, project.workspaceSlug, project.projectId, item.id);
      expect(workItem.label_ids).not.toContain(front.id);
    }
  });
});
