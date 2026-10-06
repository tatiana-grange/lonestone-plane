/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Locator, Page } from "@playwright/test";
import type { ProjectFixture } from "./fixtures";
import { expect, test } from "./fixtures";
import type { TProjectDisplayFilters, TWorkItem } from "./helpers/plane";
import { createWorkItem, setProjectLayout } from "./helpers/plane";
import { projectIssuesUrl } from "./helpers/urls";

const NAMES = ["Alpha", "Bravo", "Charlie", "Delta"];

async function openLayout(
  page: Page,
  project: ProjectFixture,
  layout: TProjectDisplayFilters["layout"]
): Promise<TWorkItem[]> {
  const items: TWorkItem[] = [];
  for (const name of NAMES) {
    // sequential on purpose: keeps sequence ids (and order) deterministic
    // oxlint-disable-next-line no-await-in-loop
    items.push(await createWorkItem(project.session, project.workspaceSlug, project.projectId, { name }));
  }
  await setProjectLayout(project.session, project.workspaceSlug, project.projectId, {
    layout,
    group_by: layout === "kanban" ? "state" : null,
    sub_group_by: null,
  });
  await page.goto(projectIssuesUrl(project.workspaceSlug, project.projectId));
  // first load of the layout: the dev server compiles routes on demand
  await expect(item(page, items[0])).toBeVisible({ timeout: 30_000 });
  return items;
}

function item(page: Page, workItem: TWorkItem): Locator {
  return page.locator(`[data-selection-entity-id="${workItem.id}"]`);
}

function title(page: Page, workItem: TWorkItem): Locator {
  return item(page, workItem).getByText(workItem.name, { exact: true });
}

function bar(page: Page): Locator {
  return page.getByTestId("bulk-operations-bar");
}

for (const layout of ["list", "spreadsheet", "kanban"] as const) {
  test.describe(`selection shortcuts (${layout})`, () => {
    test("Cmd/Ctrl + click toggles items without opening them", async ({ page, project }) => {
      const items = await openLayout(page, project, layout);

      await title(page, items[0]).click({ modifiers: ["ControlOrMeta"] });
      await title(page, items[1]).click({ modifiers: ["ControlOrMeta"] });

      await expect(bar(page)).toContainText("2 selected");
      await expect(page.getByTestId("issue-peek-overview")).toBeHidden();
      expect(page.context().pages()).toHaveLength(1);
    });

    test("X toggles the hovered item", async ({ page, project }) => {
      const items = await openLayout(page, project, layout);

      await title(page, items[2]).hover();
      await page.keyboard.press("x");
      await expect(bar(page)).toContainText("1 selected");

      await page.keyboard.press("x");
      await expect(bar(page)).toBeHidden();
    });

    test("Cmd/Ctrl + A selects every displayed item", async ({ page, project }) => {
      await openLayout(page, project, layout);

      await page.keyboard.press("ControlOrMeta+a");

      await expect(bar(page)).toContainText(`${NAMES.length} selected`);
    });

    test("shortcuts are ignored while typing in a field", async ({ page, project }) => {
      const items = await openLayout(page, project, layout);
      // a plain text field, standing for any search or title input of the page
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.setAttribute("data-testid", "typing-field");
        document.body.appendChild(input);
      });
      const field = page.getByTestId("typing-field");

      await title(page, items[0]).hover();
      await field.focus();
      await page.keyboard.type("x");
      await page.keyboard.press("ControlOrMeta+a");

      await expect(field).toHaveValue("x");
      await expect(bar(page)).toBeHidden();
    });
  });
}

test.describe("selection shortcuts (gantt)", () => {
  test("Cmd/Ctrl + click and Cmd/Ctrl + A work in the sidebar", async ({ page, project }) => {
    const items = await openLayout(page, project, "gantt_chart");

    await title(page, items[0]).click({ modifiers: ["ControlOrMeta"] });
    await expect(bar(page)).toContainText("1 selected");

    await page.keyboard.press("ControlOrMeta+a");
    await expect(bar(page)).toContainText(`${NAMES.length} selected`);
  });
});

test("list: the existing checkbox and Shift + click still select ranges", async ({ page, project }) => {
  const items = await openLayout(page, project, "list");

  await title(page, items[0]).hover();
  await page.locator(`input[data-entity-id="${items[0].id}"]`).click();
  await title(page, items[2]).hover();
  await page.locator(`input[data-entity-id="${items[2].id}"]`).click({ modifiers: ["Shift"] });

  await expect(bar(page)).toContainText("3 selected");
});

test("list: a click on the empty area below the rows clears the selection", async ({ page, project }) => {
  const items = await openLayout(page, project, "list");

  await title(page, items[0]).click({ modifiers: ["ControlOrMeta"] });
  await title(page, items[1]).click({ modifiers: ["ControlOrMeta"] });
  await expect(bar(page)).toContainText("2 selected");

  // just below the quick-add line that follows the rows: empty list space
  const quickAdd = await page.getByText("New work item", { exact: true }).last().boundingBox();
  const lastRow = await item(page, items[items.length - 1]).boundingBox();
  if (!quickAdd || !lastRow) throw new Error("List is not visible");
  await page.mouse.click(lastRow.x + lastRow.width / 2, quickAdd.y + quickAdd.height + 40);

  await expect(bar(page)).toBeHidden();
});
