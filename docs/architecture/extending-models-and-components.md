# Adding Fields and Modifying Pages in Your Fork

This document covers the two most frequent customisation needs in detail:

1. **Adding data to existing models** (e.g. a new field on `Issue`)
2. **Modifying existing pages and components**

Both require understanding exactly how the extension seam works in practice, not just in theory.

**Backend home for all fork additions:** `apps/api/plane/extended/` (`plane.extended`), API prefix `/api/extended/`, tables `extended_*`. See [Fork maintenance](./fork-maintenance.md).

---

## Part 1 — Adding Fields to Existing Models

### The core constraint

Django's migration system ties each migration to a specific **app label**. When you write `migrations.AddField(model_name="issue", ...)`, Django looks up the `Issue` model through the `db` app's registry. You cannot add a field to `plane.db.models.Issue` from a migration in `plane.extended` using the normal `AddField` operation — Django raises an error because it doesn't consider that model yours to alter.

This leaves four real options, with very different tradeoffs.

---

### Option A — OneToOne extension model (recommended for many fields)

Create a companion model in your own app that holds your extra fields.

```python
# apps/api/plane/extended/models/issue_extension.py
from plane.db.models import BaseModel
from django.db import models

class IssueExtension(BaseModel):
    issue = models.OneToOneField(
        "db.Issue",
        on_delete=models.CASCADE,
        related_name="extended_issue",
        primary_key=True,
    )
    customer_id    = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    severity       = models.CharField(max_length=50, blank=True, null=True)
    internal_notes = models.TextField(blank=True)

    class Meta:
        db_table = "extended_issue_extensions"
```

Migration in `plane/extended/migrations/` — zero collision with upstream.

**Exposing it in the API:**

You need new API endpoints because the upstream `IssueSerializer` doesn't know about `extended_issue`. Two patterns:

**Pattern 1 — Separate endpoint** (safest, zero upstream changes):

```python
# extended/views/issue_extension.py
class IssueExtensionView(APIView):
    def get(self, request, workspace_slug, project_id, issue_id):
        ext, _ = IssueExtension.objects.get_or_create(issue_id=issue_id)
        return Response(IssueExtensionSerializer(ext).data)

    def patch(self, request, workspace_slug, project_id, issue_id):
        ext, _ = IssueExtension.objects.get_or_create(issue_id=issue_id)
        serializer = IssueExtensionSerializer(ext, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
```

Frontend fetches this alongside the normal issue data and merges in the store.

**Pattern 2 — Annotated queryset in your own issue view** (if you want a single response):

Override the issue retrieve endpoint in your `extended/views/`, call `select_related("extended_issue")`, and return a combined serializer. Duplicate some upstream view logic, but it's isolated to your app.

**Drawback:** The upstream issue list views (which you don't control) won't include your fields. You'd need to handle that either via a separate field-fetch per issue (inefficient) or by overriding the list view too.

---

### Option B — Direct column addition with RunSQL (recommended for 1–2 fields on a hot model)

Add the column directly to the upstream table with a `RunSQL` migration in your app, then add the field to the model file.

**Step 1 — Migration in your app:**

```python
# extended/migrations/0003_issue_customer_id.py
from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        ("extended", "0002_previous"),
        ("db", "0121_alter_estimate_type"),  # pin to latest known upstream
    ]
    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE issues
                ADD COLUMN IF NOT EXISTS customer_id VARCHAR(255) NULL;
                CREATE INDEX IF NOT EXISTS issues_customer_id_idx ON issues(customer_id);
            """,
            reverse_sql="ALTER TABLE issues DROP COLUMN IF EXISTS customer_id;",
        ),
    ]
```

**Step 2 — Add the field to the model (touch `plane/db/models/issue.py`):**

```python
# In Issue model — add one line
customer_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)
```

**Merge strategy when upstream adds a migration to `plane.db`:**

```bash
git merge upstream/preview
# Conflict: possibly in issue.py if upstream also added a field (rare)
# No conflict in migrations (your migration file has a new name, upstream's is different)

# After merge, update your migration's dependency pin:
#   ("db", "0122_whatever_upstream_added"),
```

Updating the `dependencies` pin in your migration after each upstream release is a one-line change that takes 30 seconds.

**Conflict risk on `issue.py`:** In practice, upstream adds fields to `Issue` roughly once per month. When it happens, the conflict is two `AddField` lines next to each other — trivially resolved. The migration file itself never conflicts because it has a unique name.

**Benefit:** The field is on the actual `Issue` model. All upstream serializers, querysets, and filters work naturally. The upstream `IssueSerializer` already uses `exclude = ["description_json", "description_stripped"]` and `read_only_fields` — your field will be included in responses automatically.

---

### Option C — JSONField on an extension model (for very dynamic extra data)

If you have a large and unpredictable set of custom fields (like Plane Pro's custom fields feature), a JSONField is more flexible than adding individual columns:

```python
class IssueCustomFields(BaseModel):
    issue = models.OneToOneField("db.Issue", on_delete=models.CASCADE, related_name="custom_fields")
    data  = models.JSONField(default=dict)

    class Meta:
        db_table = "extended_issue_custom_fields"
```

**Tradeoff:** Flexible but not queryable with normal ORM filters. Good for display-only custom metadata; bad for filtering/sorting issues by those values without raw SQL.

---

### Option D — Fork the model directly (use cautiously)

Add the field directly to `Issue` and create a migration in `plane/db/migrations/`. Use a **high-numbered prefix** to avoid collisions:

```python
# plane/db/migrations/9001_our_customer_id.py
class Migration(migrations.Migration):
    dependencies = [
        ("db", "0121_alter_estimate_type"),
    ]
    operations = [
        migrations.AddField(
            model_name="issue",
            name="customer_id",
            field=models.CharField(max_length=255, blank=True, null=True),
        ),
    ]
```

Prefix `9000+` is safe — upstream won't reach that range before you'd need to rebase anyway.

**Risk:** On every upstream merge, you need to check if upstream added a `0122_xxx.py` and update your `9001` to depend on it. Miss this once and migrations break silently. It's manageable with the automated merge procedure but adds a consistent maintenance step.

---

### Decision guide

| Scenario                                        | Recommendation                 |
| ----------------------------------------------- | ------------------------------ |
| 1–3 fields, need them in list views and filters | Option B (RunSQL + model edit) |
| Many fields, only used in detail view           | Option A (OneToOne extension)  |
| Dynamic user-defined fields (Notion-like)       | Option C (JSONField extension) |
| You're comfortable accepting a merge step       | Option D (direct)              |

---

## Part 2 — Modifying Existing Pages and Components

### The two-tier reality

Not all files in the codebase are equally safe to touch. After reading every `app/` file that imports from `@/plane-web`:

**Tier 1 — Fully overridable via your edition layer (no conflict risk)**

These `app/` files import their main component from `@/plane-web/`, so your `oe/` folder controls what renders:

| File                         | Overridable via `oe/`                                         |
| ---------------------------- | ------------------------------------------------------------- |
| `[workspaceSlug]/layout.tsx` | `WorkspaceContentWrapper`, `GlobalModals`                     |
| `projects/(list)/page.tsx`   | `ProjectPageRoot`                                             |
| `browse/[workItem]/page.tsx` | `WorkItemDetailRoot` ← **this is the full issue detail page** |
| `active-cycles/page.tsx`     | `WorkspaceActiveCyclesRoot`                                   |
| `analytics/[tabId]/page.tsx` | `useAnalyticsTabs`                                            |
| `settings/billing/page.tsx`  | `BillingRoot`                                                 |
| All issue headers            | `IssuesHeader`                                                |
| All breadcrumb headers       | `CommonProjectBreadcrumbs`                                    |
| Pages list/detail            | `EPageStoreType`, `usePageStore`, `usePage`                   |

Additionally, 330 places in `core/` delegate to `@/plane-web/` for specific sub-components. The most important ones for customising the issue experience:

| Import in `core/`                                                       | What it controls                  |
| ----------------------------------------------------------------------- | --------------------------------- |
| `@/plane-web/components/issues/issue-details/additional-properties`     | Extra fields in the issue sidebar |
| `@/plane-web/components/issues/issue-modal/modal-additional-properties` | Extra fields in create/edit modal |
| `@/plane-web/components/issues/worklog/property`                        | Worklog field in sidebar          |
| `@/plane-web/components/cycles/additional-actions`                      | Extra buttons on cycle list items |
| `@/plane-web/components/issues/header`                                  | Issues page header bar            |
| `@/plane-web/components/workspace/content-wrapper`                      | Workspace layout wrapper          |
| `@/plane-web/components/common/modal/global`                            | Global modal registry             |

**Tier 2 — Thin app/ files, safe to own directly**

These `app/` files import from `@/components` (core) and have no `@/plane-web` hook yet. They are very thin (10–25 lines), mostly just calling one core component:

```tsx
// issues/(list)/page.tsx — 25 lines total, just calls ProjectLayoutRoot
<ProjectLayoutRoot />
```

You have two sub-options here:

**Sub-option 2a — Modify the `app/` file directly.** Since these files are so thin, merging upstream changes is easy. When upstream changes `app/[workspaceSlug]/.../issues/(list)/page.tsx`, it will almost always be: changing what component it calls, or adding a prop. A `git diff` shows this immediately and you re-apply your change in seconds.

**Sub-option 2b — Add an `@/plane-web` hook to the core component** (the cleaner approach). Touch `core/` once to add a single import, then never touch `core/` again:

```tsx
// core/components/issues/issue-layouts/roots/project-layout-root.tsx
// Add one import:
import { ProjectLayoutRootWrapper } from "@/plane-web/components/issues/issue-layouts/root-wrapper";

// Wrap the return:
return <ProjectLayoutRootWrapper>{/* existing content */}</ProjectLayoutRootWrapper>;
```

Then your `oe/` provides `ProjectLayoutRootWrapper` as either a passthrough (`<>{children}</>`) or something that adds UI. Future merges: if upstream changes `project-layout-root.tsx`, you re-add your one-line wrapper import — easily auditable.

---

### Concrete walkthrough: adding a custom field to the issue sidebar

This is the most common customisation. Here's the full stack end-to-end.

**1. Backend — add the field (Option B from above):**

```python
# extended/migrations/0003_issue_customer_id.py
migrations.RunSQL("ALTER TABLE issues ADD COLUMN IF NOT EXISTS customer_id VARCHAR(255) NULL;")

# plane/db/models/issue.py — add field to Issue model
customer_id = models.CharField(max_length=255, blank=True, null=True)
```

**2. API — field is now automatically included** in the upstream `IssueSerializer` response (because it uses `exclude` not `fields`). No serializer changes needed for read. For write, add it to the view's `update()` logic or it'll be accepted automatically via DRF's model serializer.

**3. Frontend — types** (`packages/types/` or your `oe/types/`):

```ts
// Extend the upstream IIssue type
export interface IIssueExtended extends IIssue {
  customer_id?: string | null;
}
```

**4. Frontend — store** (`oe/store/issue/`): the upstream stores already merge all API response fields into the MobX observable. Since your field is now in the API response, it's in the store automatically. No store change needed unless you want type-safe access.

**5. Frontend — sidebar component** (`oe/components/issues/issue-details/additional-properties.tsx`):

This file is already the designed injection point. The CE version (`ce/components/issues/issue-details/additional-properties.tsx`) returns `<>/<>`. Replace it in your edition layer:

```tsx
// oe/components/issues/issue-details/additional-properties.tsx
import { observer } from "mobx-react";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

export type TWorkItemAdditionalSidebarProperties = {
  workItemId: string;
  workItemTypeId: string | null;
  projectId: string;
  workspaceSlug: string;
  isEditable: boolean;
  isPeekView?: boolean;
};

export const WorkItemAdditionalSidebarProperties = observer(function WorkItemAdditionalSidebarProperties({
  workItemId,
  isEditable,
}: TWorkItemAdditionalSidebarProperties) {
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const issue = getIssueById(workItemId) as any; // use your extended type

  return (
    <div className="py-2 border-t border-subtle">
      <label className="text-xs font-medium text-secondary">Customer ID</label>
      <input
        value={issue?.customer_id ?? ""}
        disabled={!isEditable}
        onChange={(e) => {
          /* call your patch API */
        }}
        className="w-full mt-1 text-sm"
      />
    </div>
  );
});
```

**Result:** The field appears in the issue sidebar on every issue. Zero files modified in `core/` or `ce/`. The only upstream-touching files are:

- `issue.py` (model field addition — rare conflict)
- `extended/migrations/0003_issue_customer_id.py` (your file, no conflict possible)

---

### Concrete walkthrough: modifying the issue list page

Suppose you want to add a banner above the issues list. The `issues/(list)/page.tsx` file does not go through `@/plane-web`. You have two choices:

**Choice A — Edit `app/.../issues/(list)/page.tsx` directly:**

```tsx
// Add your banner before ProjectLayoutRoot
return (
  <>
    <PageHead title={pageTitle} />
    <OurFeatureBanner projectId={projectId} /> {/* your addition */}
    <div className="h-full w-full">
      <ProjectLayoutRoot />
    </div>
  </>
);
```

File is 25 lines. When upstream changes it, the diff will be obvious and your banner line re-applies in seconds. This is acceptable for thin route files.

**Choice B — Add a hook to `core/` once:**

```tsx
// core/components/issues/issue-layouts/roots/project-layout-root.tsx
// Add at the top:
import { ProjectIssueListBanner } from "@/plane-web/components/issues/issue-layouts/banner";

// Add in the JSX:
return (
  <IssuesStoreContext.Provider value={EIssuesStoreType.PROJECT}>
    <ProjectIssueListBanner workspaceSlug={workspaceSlug} projectId={projectId} />
    {/* existing content */}
  </IssuesStoreContext.Provider>
);
```

Then in `oe/`:

```tsx
// oe/components/issues/issue-layouts/banner.tsx
export function ProjectIssueListBanner({ projectId }) {
  return <OurBannerContent projectId={projectId} />;
}
```

After the initial touch to `core/`, you never need to touch it again — even when upstream changes `project-layout-root.tsx`, they won't remove your one wrapper import (it's a compile error if they do, which you'd catch in CI immediately).

---

### Handling upstream changes to components you've overridden

When you override a CE component in `oe/`, you hold a **static copy** of its interface. If upstream changes the prop types or behaviour of the slot, your override might become stale.

**Catching prop changes automatically:**

Export and re-use the CE type in your override:

```ts
// In your oe/ component:
import type { TWorkItemAdditionalSidebarProperties } from "@/plane-web/components/issues/issue-details/additional-properties";

// Your implementation must satisfy the same type:
export function WorkItemAdditionalSidebarProperties(props: TWorkItemAdditionalSidebarProperties) { ... }
```

Since the type comes from your `oe/` (which you control), this only helps if upstream changes the type through `core/` and the call site changes. Run `pnpm check:types` after every upstream merge — TypeScript will surface mismatches at the point of use in `core/`.

**Catching behavioural drift:**

Add integration tests for your custom components that assert the expected props flow. When the test fails after a merge, you know something changed. This is more valuable than manual review.

---

### Core files touched by fork features

Some fork features need a few lines in `core/` because upstream offers no `@/plane-web` hook at that point. Re-check these after every `upstream/preview` merge.

Any change to a file in `apps/web/core/` or `packages/` goes into this table, with its reason, in the same commit. A file missing from it will not be checked on the next upstream merge.

The pre-commit hook runs `oxlint --deny-warnings` on every committed file, so touching a `core/` file also surfaces its existing upstream warnings. Silence them with an `oxlint-disable-next-line <rule> -- upstream code, …` comment rather than fixing them: a fix rewrites upstream lines and turns the next merge of that code into a conflict.

**Bulk edit of work item properties (LONESTONEP-5)**

| Core file                                          | Change                                                                                                                                                                                   | Why                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `core/hooks/use-bulk-operation-status.ts`          | Re-exports `useBulkOperationStatus` from `@/plane-web/hooks/use-bulk-operation-status`                                                                                                   | Upstream hard-codes `() => false`, which hides the selection checkboxes                                                               |
| `core/components/issues/bulk-operations/root.tsx`  | Renders `BulkOperationsBar` from `@/plane-web/components/issues/bulk-operations` instead of `BulkOperationsUpgradeBanner`                                                                | Keeps upstream's display rule (active, enabled selection) and its call sites in every layout; only the paid-edition banner is swapped |
| `core/services/issue/issue.service.ts`             | `bulkOperations` posts to `/api/extended/.../issues/bulk-update/` (URL only)                                                                                                             | The upstream endpoint only exists in the paid edition                                                                                 |
| `core/store/issue/helpers/base-issues.store.ts`    | `bulkUpdateProperties` also handles the `remove_*` keys (difference instead of union), takes work items out of the current module's list and refreshes the current cycle or module stats | Issue list updates (`updateIssueList`) are internal to the base store; upstream's loop and `Promise<void>` signature are kept         |
| `packages/i18n/src/locales/{en,fr}/work-item.json` | Adds keys at the end of `bulk_operations` (`selected_count`, `clear_selection`, `clear_*_date`, `toast.*`, `failure_reasons.*`); no upstream key is changed                              | The fork has no translation namespace of its own; on a merge conflict, keep upstream's keys and re-append ours                        |
| `packages/types/src/issues/issue.ts`               | Adds `TBulkIssueRemovals` (`remove_assignee_ids`, `remove_label_ids`, `remove_module_ids`) to the bulk payload                                                                           | Tri-state removals (spec 003)                                                                                                         |

The bar itself lives in `oe/components/issues/bulk-operations/`. The assignee, label and module menus copy the option rendering of the upstream dropdowns in `oe/components/issues/bulk-operations/dropdown-options.tsx` instead of importing it from `core/`; re-check it when upstream restyles those dropdowns. The backend lives in `plane.extended` (`issue_bulk_update` view, serializer and service).

The API is all or nothing, to fit the upstream store: if one work item cannot take the change, it answers `400 {"error", "code"}` and writes nothing. The codes the bar translates are `not_found` (a work item was deleted, archived or moved) and `invalid_date_range` (the start date would end up after the due date). The bar sends batches of 500 work items, the API limit; if a later batch fails, the toast reports how many were saved before it.

**Dropped: per-work-item partial success**

A first version reported a result per work item, so that one bad work item did not block the others ("48 updated, 2 skipped: start date after due date"). It was removed because it did not fit the fork's constraint of staying as close as possible to upstream: it changed upstream signatures in nine `core/` files for a feature upstream does not have. Do not bring it back without weighing that cost again. How it worked, in case it is needed:

- API: `200` with `{"updated_issue_ids", "unchanged_issue_ids", "failed": [{"issue_id", "code"}]}`. A work item not found or with an invalid date range went to `failed` instead of rejecting the request; the others were still written.
- Types: `TBulkOperationsFailureCode` and `TBulkOperationsResponse` in `packages/types/src/issues/issue.ts`.
- Service: `bulkOperations` returned `Promise<TBulkOperationsResponse>` instead of `Promise<any>`.
- Base store: `bulkUpdateProperties` returned the response and applied the change to `response.updated_issue_ids` only, not to every sent id (upstream assumes they all succeed).
- The eight `core/store/issue/*/issue.store.ts` files: each interface (`IProjectIssues`, `ICycleIssues`, …) declares its own `bulkUpdateProperties` with `Promise<void>`. They all had to return `Promise<TBulkOperationsResponse>`, otherwise the bar, which reads the union of the stores, cannot access the response. TypeScript does not accept a `Promise<Response>` implementation behind a `Promise<void>` interface, so there is no way around these files without lying casts.
- Bar: merged the responses of the batches and showed a warning toast with one counted reason per failure code (`failure_reasons.*` used ICU plurals).

**Board multi-select (LONESTONEP-5, spec 002)**

| Core file                                                          | Change                                                                                                                                    | Why                                                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `core/components/issues/issue-layouts/kanban/base-kanban-root.tsx` | Renders `BoardSelection` from `@/plane-web/components/issues/board-selection` next to the board's scroll container (one import, one line) | The board has no selection upstream and no `@/plane-web` extension point            |
| `core/components/issues/issue-layouts/kanban/block.tsx`            | Renders `BoardCardSelection` inside the card wrapper (one import, one line)                                                               | Card checkbox, selected border and touch selection; the card itself is not modified |

New fork code: `oe/components/issues/board-selection/`. `BoardSelection` builds the selection groups, renders the bulk bar over the bottom of the board and publishes the selection helpers in a MobX box (`helpers-store.ts`), since it is a sibling of the board rather than a wrapper. `BoardCardSelection` reads them and wires touch selection on the card wrapper with native listeners. It only uses the upstream selection helpers (`handleEntityClick`). There is no column "select all" checkbox: upstream has no extension point in the column header, and Plane only offers bulk operations in the list and spreadsheet layouts.

---

### Summary table

| What you want to do                   | Where to write code                                                     | Upstream file touched?   |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| New field in issue sidebar            | `oe/components/issues/issue-details/additional-properties.tsx`          | `issue.py` (1 line)      |
| New field in create/edit modal        | `oe/components/issues/issue-modal/modal-additional-properties.tsx`      | `issue.py` (1 line)      |
| Extra button on cycle list            | `oe/components/cycles/additional-actions.tsx`                           | none                     |
| Wrap the workspace layout             | `oe/components/workspace/content-wrapper.tsx`                           | none                     |
| Add content to issue list page        | `app/.../issues/(list)/page.tsx` (edit directly) OR add hook to `core/` | `page.tsx` (25 lines)    |
| Completely replace issue detail       | `oe/components/browse/workItem-detail.tsx`                              | none                     |
| Add a new settings page               | New file in `app/.../settings/`                                         | none                     |
| New data on Issue model (1-2 fields)  | `extended/migrations/RunSQL` + `issue.py`                               | `issue.py` (1 line)      |
| New data on Issue model (many fields) | `extended/models/IssueExtension` (OneToOne)                             | none                     |
| New model entirely                    | `extended/models/`                                                      | none                     |
| New API endpoint                      | `extended/views/` + `extended/urls.py`                                  | `plane/urls.py` (1 line) |
