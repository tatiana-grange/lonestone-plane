# web-e2e

Playwright end-to-end tests for the web app (`apps/web`), driven in a real browser against a real Plane backend.

## Dedicated environment

The suite never touches the dev stack. Each run gets its own environment:

| Piece                                  | Where                                                                   | Started by                                   |
| -------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| API + Postgres, Redis, RabbitMQ, MinIO | `docker-compose-e2e.yml` (project `plane-e2e`, API on `localhost:8200`) | `tests/global-setup.ts`, with testcontainers |
| Web dev server                         | `localhost:3200`, pointed at the e2e API                                | `playwright.config.ts` (`webServer`)         |

The database lives in tmpfs and is freshly migrated on every run. The global setup then creates the instance admin (what the god-mode first-run screen does), so no manual setup is needed. The stack is removed at the end of the run.

Each test arranges its own data through the app API (`tests/helpers/plane.ts`): it signs up a throwaway user, which also logs the page in, then creates a workspace, a project and work items. Tests do not depend on each other or on any seed.

## Prerequisites

- Docker running.
- `apps/api/.env` exists (`./setup.sh` at the repo root, same as the pytest stack).
- Chromium for Playwright, once: `pnpm --filter=web-e2e exec playwright install chromium`.

## Commands

```bash
pnpm --filter=web-e2e test:e2e        # full run: start the stack, run, tear down
pnpm --filter=web-e2e test:e2e:ui     # Playwright UI mode
E2E_KEEP_STACK=1 pnpm --filter=web-e2e test:e2e   # keep the stack running for the next runs
docker compose -f docker-compose-e2e.yml down -v  # remove a kept stack
```

The first run builds the API image and migrates an empty database: allow a few minutes.

## Writing tests

- Use the `project` fixture from `tests/fixtures.ts` for a logged-in user that owns a fresh workspace and project.
- Arrange through `tests/helpers/plane.ts` (API), act through the UI, assert on the UI and, when it matters, on the API.
- Prefer roles and visible text for selectors; add a `data-testid` to the component when there is no stable alternative.
