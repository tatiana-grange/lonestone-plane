/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Locator, Page } from "@playwright/test";
import type { ProjectFixture } from "./fixtures";
import { expect, test } from "./fixtures";
import type { TWorkItem } from "./helpers/plane";
import { createWorkItem, getWorkItem, setProjectLayout } from "./helpers/plane";
import { projectIssuesUrl } from "./helpers/urls";

function stateId(project: ProjectFixture, name: string): string {
  const state = project.states.find((candidate) => candidate.name === name);
  if (!state) throw new Error(`No "${name}" state in the project`);
  return state.id;
}

/** Creates work items in the given states (one per entry, in order) and opens the project board. */
async function openBoard(
  page: Page,
  project: ProjectFixture,
  items: { name: string; state: string; priority?: TWorkItem["priority"] }[],
  displayFilters: { group_by?: string; sub_group_by?: string | null } = {}
): Promise<TWorkItem[]> {
  const created: TWorkItem[] = [];
  for (const item of items) {
    // sequential on purpose: keeps sequence ids (and card order) deterministic
    // oxlint-disable-next-line no-await-in-loop
    const workItem = await createWorkItem(project.session, project.workspaceSlug, project.projectId, {
      name: item.name,
      state_id: stateId(project, item.state),
      ...(item.priority ? { priority: item.priority } : {}),
    });
    created.push(workItem);
  }
  await setProjectLayout(project.session, project.workspaceSlug, project.projectId, {
    layout: "kanban",
    group_by: "state",
    sub_group_by: null,
    ...displayFilters,
  });
  await page.goto(projectIssuesUrl(project.workspaceSlug, project.projectId));
  // the first load of a board fetches every column (and every swimlane cell) separately
  await expect(card(page, created[0])).toBeVisible({ timeout: 30_000 });
  return created;
}

function card(page: Page, item: TWorkItem): Locator {
  return page.locator(`#issue-${item.id}`);
}

/** Clicks the card title, away from the inline property buttons. */
async function clickCard(page: Page, item: TWorkItem, modifiers: ("ControlOrMeta" | "Shift")[] = []): Promise<void> {
  await card(page, item).getByText(item.name, { exact: true }).click({ modifiers });
}

function bar(page: Page): Locator {
  return page.getByTestId("bulk-operations-bar");
}

function peek(page: Page): Locator {
  return page.getByTestId("issue-peek-overview");
}

test.describe("board selection (mouse)", () => {
  test("Cmd/Ctrl + click toggles cards without opening them", async ({ page, project }) => {
    const items = await openBoard(page, project, [
      { name: "Backlog card", state: "Backlog" },
      { name: "Todo card", state: "Todo" },
      { name: "Doing card", state: "In Progress" },
    ]);

    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      await clickCard(page, item, ["ControlOrMeta"]);
    }

    await expect(bar(page)).toContainText("3 selected");
    await expect(peek(page)).toBeHidden();
    expect(page.context().pages()).toHaveLength(1);

    await clickCard(page, items[0], ["ControlOrMeta"]);
    await expect(bar(page)).toContainText("2 selected");
  });

  test("the hover checkbox selects a card", async ({ page, project }) => {
    const [item] = await openBoard(page, project, [{ name: "Only card", state: "Todo" }]);

    await card(page, item).hover();
    await page.getByRole("checkbox", { name: "Select BULK-1" }).click();

    await expect(bar(page)).toContainText("1 selected");
  });

  test("a bulk state change moves the cards and keeps them selected", async ({ page, project }) => {
    const items = await openBoard(page, project, [
      { name: "First", state: "Backlog" },
      { name: "Second", state: "Todo" },
      { name: "Third", state: "Todo" },
    ]);
    const inProgress = stateId(project, "In Progress");

    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      await clickCard(page, item, ["ControlOrMeta"]);
    }
    await bar(page).getByRole("button", { name: "State", exact: true }).first().click();
    await page.getByRole("option", { name: "In Progress" }).click();

    await expect(page.getByText("3 work items updated")).toBeVisible();
    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop
      expect((await getWorkItem(project.session, project.workspaceSlug, project.projectId, item.id)).state_id).toBe(
        inProgress
      );
      // grouped by state: the card's selection group is now the "In Progress" column
      // oxlint-disable-next-line no-await-in-loop
      await expect(card(page, item)).toHaveAttribute("data-selection-group-id", inProgress);
    }
    await expect(bar(page)).toContainText("3 selected");
  });

  test("a plain click still opens the card and keeps the selection", async ({ page, project }) => {
    const items = await openBoard(page, project, [
      { name: "Selected card", state: "Todo" },
      { name: "Opened card", state: "Todo" },
    ]);

    await clickCard(page, items[0], ["ControlOrMeta"]);
    await clickCard(page, items[1]);

    await expect(peek(page)).toBeVisible();
    await expect(bar(page)).toContainText("1 selected");
  });

  test("Escape closes an open menu before clearing the selection", async ({ page, project }) => {
    const [item] = await openBoard(page, project, [{ name: "Card", state: "Todo" }]);

    await clickCard(page, item, ["ControlOrMeta"]);
    await bar(page).getByRole("button", { name: "State", exact: true }).first().click();
    await expect(page.getByRole("option", { name: "In Progress" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("option", { name: "In Progress" })).toBeHidden();
    await expect(bar(page)).toContainText("1 selected");

    await page.keyboard.press("Escape");
    await expect(bar(page)).toBeHidden();
  });
});

/** Dispatches a touch long press (pointer down, hold, pointer up) on the target. */
async function longPress(target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("Card is not visible");
  const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await target.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, button: 0, ...point });
  await target.page().waitForTimeout(700);
  await target.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, button: 0, ...point });
}

test.describe("board selection (touch)", () => {
  test.use({ hasTouch: true });

  test("long press selects, taps toggle while selecting, and a tap opens again once cleared", async ({
    page,
    project,
  }) => {
    const items = await openBoard(page, project, [
      { name: "Pressed", state: "Todo" },
      { name: "Tapped A", state: "Todo" },
      { name: "Tapped B", state: "In Progress" },
    ]);

    await longPress(card(page, items[0]).getByText(items[0].name, { exact: true }));
    await expect(bar(page)).toContainText("1 selected");
    await expect(peek(page)).toBeHidden();

    await card(page, items[1]).getByText(items[1].name, { exact: true }).tap();
    await card(page, items[2]).getByText(items[2].name, { exact: true }).tap();
    await expect(bar(page)).toContainText("3 selected");
    await expect(peek(page)).toBeHidden();

    await bar(page).getByRole("button", { name: "Clear selection" }).click();
    await expect(bar(page)).toBeHidden();
    await card(page, items[1]).getByText(items[1].name, { exact: true }).tap();
    await expect(peek(page)).toBeVisible();
  });
});

test.describe("board selection (ranges and columns)", () => {
  test("Shift + click selects a range within a column only", async ({ page, project }) => {
    const items = await openBoard(page, project, [
      { name: "Todo 1", state: "Todo" },
      { name: "Todo 2", state: "Todo" },
      { name: "Todo 3", state: "Todo" },
      { name: "Todo 4", state: "Todo" },
      { name: "Backlog 1", state: "Backlog" },
    ]);
    const todoColumn = await Promise.all(
      items.slice(0, 4).map(async (item) => ({ item, box: await card(page, item).boundingBox() }))
    );
    // cards are ordered top to bottom in the column; select the first and shift + click the last
    todoColumn.sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0));
    await clickCard(page, todoColumn[0].item, ["ControlOrMeta"]);
    await clickCard(page, todoColumn[3].item, ["Shift"]);
    await expect(bar(page)).toContainText("4 selected");

    await clickCard(page, items[4], ["Shift"]);
    await expect(bar(page)).toContainText("5 selected");
  });

  test("the column checkbox selects, shows partial state and unselects its column", async ({ page, project }) => {
    const items = await openBoard(page, project, [
      { name: "Backlog A", state: "Backlog" },
      { name: "Backlog B", state: "Backlog" },
      { name: "Todo A", state: "Todo" },
    ]);
    const backlogCheckbox = page.getByRole("checkbox", { name: "Select all in Backlog" });

    await clickCard(page, items[2], ["ControlOrMeta"]);
    await backlogCheckbox.click();
    await expect(bar(page)).toContainText("3 selected");
    await expect(backlogCheckbox).toBeChecked();

    await clickCard(page, items[0], ["ControlOrMeta"]);
    await expect(backlogCheckbox).not.toBeChecked();
    expect(
      await backlogCheckbox.evaluate((input) => (input as unknown as { indeterminate: boolean }).indeterminate)
    ).toBe(true);

    await backlogCheckbox.click();
    await backlogCheckbox.click();
    await expect(bar(page)).toContainText("1 selected");
  });

  test("with swimlanes, the column checkbox covers every row and ranges stay in a cell", async ({ page, project }) => {
    const items = await openBoard(
      page,
      project,
      [
        { name: "Urgent todo", state: "Todo", priority: "urgent" },
        { name: "Low todo", state: "Todo", priority: "low" },
        { name: "Low backlog", state: "Backlog", priority: "low" },
      ],
      { group_by: "state", sub_group_by: "priority" }
    );

    await page.getByRole("checkbox", { name: "Select all in Todo" }).click();
    await expect(bar(page)).toContainText("2 selected");

    await bar(page).getByRole("button", { name: "Clear selection" }).click();
    await clickCard(page, items[0], ["ControlOrMeta"]);
    await clickCard(page, items[1], ["Shift"]);
    // different swimlanes: no range, only the clicked card is added
    await expect(bar(page)).toContainText("2 selected");
  });

  test("cards moved by a bulk change can be unselected from their new column", async ({ page, project }) => {
    const items = await openBoard(page, project, [
      { name: "Mover A", state: "Backlog" },
      { name: "Mover B", state: "Backlog" },
      { name: "Stayer", state: "Done" },
    ]);

    await clickCard(page, items[0], ["ControlOrMeta"]);
    await clickCard(page, items[1], ["ControlOrMeta"]);
    await clickCard(page, items[2], ["ControlOrMeta"]);
    await bar(page).getByRole("button", { name: "State", exact: true }).first().click();
    await page.getByRole("option", { name: "Todo" }).click();
    await expect(page.getByText("3 work items updated")).toBeVisible();
    await expect(bar(page)).toContainText("3 selected");

    // the moved cards now belong to the Todo column (and Stayer too)
    const todoCheckbox = page.getByRole("checkbox", { name: "Select all in Todo" });
    await expect(todoCheckbox).toBeChecked();
    await todoCheckbox.click();
    await expect(bar(page)).toBeHidden();
  });
});

test.describe("board selection (keyboard and assistive technologies)", () => {
  test("card and column checkboxes are keyboard operable and labelled", async ({ page, project }) => {
    await openBoard(page, project, [
      { name: "Keyboard A", state: "Todo" },
      { name: "Keyboard B", state: "Todo" },
    ]);
    const cardCheckbox = page.getByRole("checkbox", { name: "Select BULK-1" });

    // reachable by keyboard focus, and revealed (not just present) while focused
    await cardCheckbox.focus();
    await expect(cardCheckbox).toBeFocused();
    await expect.poll(() => cardCheckbox.evaluate((input) => getComputedStyle(input.parentElement!).opacity)).toBe("1");

    await page.keyboard.press("Space");
    await expect(cardCheckbox).toBeChecked();
    await expect(bar(page)).toContainText("1 selected");

    // the counter is announced and the column exposes its partial state
    await expect(bar(page).getByText("1 selected")).toHaveAttribute("aria-live", "polite");
    const columnCheckbox = page.getByRole("checkbox", { name: "Select all in Todo" });
    expect(await columnCheckbox.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(true);
  });
});
