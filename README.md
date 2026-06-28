# iMessage Scheduler

Schedule a message and have it sent over iMessage at a time you choose, with live, end-to-end delivery tracking. The app exposes a web UI for composing and scheduling messages, a backend that owns a throttled FIFO queue, and a pluggable gateway that either simulates sending or drives **Messages.app** on macOS for real. Delivery status is reconciled against the real iMessage database (`chat.db`), and an analytics dashboard summarises throughput and per-stage timing.

This document covers how to run everything locally, how to run the tests and, in detail, every business rule and design decision behind the system.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Tech stack and why](#tech-stack-and-why)
4. [Prerequisites](#prerequisites)
5. [Quick start (local)](#quick-start-local)
6. [Environment variables](#environment-variables)
7. [Running the tests](#running-the-tests)
8. [Business rules and design decisions](#business-rules-and-design-decisions)
9. [Using the real iMessage gateway (macOS)](#using-the-real-imessage-gateway-macos)
10. [Limitations and known caveats](#limitations-and-known-caveats)
11. [Scripts reference](#scripts-reference)
12. [Project layout](#project-layout)

---

## What it does

- **Compose and schedule** a message to a phone number, choosing the send time, from a browser UI.
- **Queue and throttle**: the backend stores each message and dispatches them FIFO, no faster than one every configurable interval (default: one per hour).
- **Send over iMessage**: a gateway sends the message. In `simulator` mode it fakes the lifecycle; in `applescript` mode it drives Messages.app on a Mac.
- **Track delivery honestly**: status moves through `QUEUED → ACCEPTED → SENT → DELIVERED → RECEIVED`, or `FAILED`. Delivery and read status come from the real iMessage `chat.db`, not from optimistic guesses.
- **Visualise**: a dashboard shows a status breakdown, a delivery funnel, failure rate, median/p95 time-to-delivery, and a 24-hour send-throughput chart.

---

## Architecture

This is a **pnpm + Turborepo monorepo** with one shared package and three runnable apps:

```
packages/shared    @ims/shared    Contracts shared by every app: status state machine,
                                  Zod input schemas, chat.db status mapping, stats DTO.
apps/backend       @ims/backend   Express API + PostgreSQL (Kysely). Owns the queue,
                                  the scheduler/throttle, retries, and the stats endpoint.
apps/gateway       @ims/gateway   Express service that actually "sends". Simulator or
                                  AppleScript sender + chat.db delivery watcher. No DB access.
apps/frontend      @ims/frontend  React + Vite UI: schedule form, live message list, dashboard.
```

### Data flow

```
  Browser (React)
      │  POST /api/messages
      ▼
  Backend  ──────────────► PostgreSQL
   │  ▲                      scheduled_messages   (one row per message)
   │  │                      message_status_events (append-only audit log)
   │  │                      scheduler_state       (singleton: throttle clock)
   │  │
   │  │ scheduler tick: claim next eligible row (FOR UPDATE SKIP LOCKED)
   │  ▼
   │  POST /send  ──────► Gateway
   │                        │  simulator: timed transitions
   │                        │  applescript: osascript → Messages.app, then
   │                        │               poll chat.db for delivery/read/error
   │  ◄── POST /api/webhooks/status ── reports SENT / DELIVERED / RECEIVED / FAILED
   ▼
  Backend applies the update (forward-only, idempotent) and appends an event.

  Browser polls GET /api/messages (every 4s) and GET /api/stats (every 5s).
```

The backend and gateway communicate over HTTP. The gateway never touches the database; it reports status back through a single webhook so that the backend stays the only writer.

### Default ports

| Service  | URL                   |
| -------- | --------------------- |
| Frontend | http://localhost:5173 |
| Backend  | http://localhost:3001 |
| Gateway  | http://localhost:3002 |
| Postgres | localhost:5432        |

The Vite dev server proxies `/api` to the backend, so there is no CORS configuration to manage in development.

---

## Tech stack and why

| Area          | Choice                                          | Reason                                                                                              |
| ------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo                     | One repo, shared contracts, cached task graph.                                                      |
| Language      | TypeScript (strict, `noUncheckedIndexedAccess`) | End-to-end type safety, including across the wire via `@ims/shared`.                                |
| Database      | PostgreSQL 16                                   | Relational integrity, row-level locking for the queue, rich SQL for analytics.                      |
| DB access     | **Kysely** (typed query builder)                | Hand-written, fully typed SQL: chosen over an ORM to keep the SQL explicit and to show query depth. |
| Validation    | Zod                                             | One schema validates HTTP input, env config, and produces shared types.                             |
| API           | Express                                         | Minimal, well understood.                                                                           |
| Frontend      | React 19 + Vite + Tailwind v4 + shadcn/ui       | Modern, fast dev loop; shadcn components are React-19-native.                                       |
| Data fetching | TanStack Query                                  | Polling, caching, and request states with little boilerplate.                                       |
| Forms         | react-hook-form + Zod resolver                  | Client-side validation that mirrors the server contract.                                            |
| Charts        | Recharts                                        | Simple, declarative throughput chart.                                                               |
| iMessage read | better-sqlite3 (read-only)                      | The macOS `chat.db` is a SQLite file; this opens it efficiently, read-only.                         |
| Tests         | Vitest + Testcontainers                         | Unit tests plus integration tests against a real, disposable Postgres.                              |

> On the database choice: **PostgreSQL is the system's database**: every table, the queue, the scheduler, the retries, and all dashboard analytics live there. **SQLite appears only because Apple's `chat.db` is a SQLite file**; the app reads that external database read-only to learn the true delivery status. It is never used to store the application's own data.

---

## Prerequisites

- **Node.js >= 22** (the repo is developed on Node 24).
- **pnpm 9.15.0** (`corepack enable` will provide it, or install manually).
- **Docker** (for Postgres locally, and for the backend's integration tests).
- **A Mac** only if you want to use the real iMessage gateway. The default `simulator` mode runs on any OS.

---

## Quick start (local)

```bash
# 1. Install dependencies
pnpm install

# 2. Create your local env file and review it
cp .env.example .env
#    The defaults work out of the box with the Postgres container below.

# 3. Start PostgreSQL
docker compose up -d
#    Wait until it is healthy. `docker compose ps` should show the port published as
#    0.0.0.0:5432->5432/tcp (not just 5432/tcp). If it is not published, run
#    `docker compose down && docker compose up -d` to recreate it.

# 4. Apply database migrations
pnpm db:migrate

# 5. Run everything (frontend, backend, gateway, shared watcher) in parallel
pnpm dev
```

Then open **http://localhost:5173**, schedule a message, and watch its status badge advance live.

> Tip for a fast demo: the global throttle defaults to one send per hour. To watch the full lifecycle immediately, set `SEND_INTERVAL_MS=0` in `.env` (no throttle) and schedule a message for the current minute. The scheduled time must be now or in the future: past times are rejected by validation (with a 60-second tolerance for clock skew).

### Common gotchas

- **`ECONNREFUSED ::1:5432`**: Postgres is not running or its port is not published. See step 3.
- **"Cannot find module @ims/shared" or stale types**: the apps consume the _built_ output of `@ims/shared`. `pnpm dev` runs its watcher automatically; if you build out of band, run `pnpm --filter @ims/shared build` and restart your editor's TS server.
- **The migrate command is `pnpm db:migrate`** (not `migrate`). `pnpm db:reset` drops and re-applies everything.

---

## Environment variables

Copy `.env.example` to `.env`. The defaults are tuned for local development; everything has a sensible fallback except `DATABASE_URL`.

### Backend (`@ims/backend`)

| Variable                | Default                                     | Meaning                                                                           |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`          | _(required)_                                | Postgres connection string.                                                       |
| `SEND_INTERVAL_MS`      | `3600000` (1 hour)                          | Minimum **global** gap between two sends (the throttle). `0` disables throttling. |
| `SCHEDULER_TICK_MS`     | `30000`                                     | How often the scheduler checks the queue.                                         |
| `MAX_ATTEMPTS`          | `3`                                         | Send attempts before a message is marked `FAILED`.                                |
| `RETRY_BACKOFF_BASE_MS` | `60000`                                     | Base delay for exponential retry backoff.                                         |
| `BACKEND_PORT`          | `3001`                                      | API port.                                                                         |
| `GATEWAY_URL`           | `http://localhost:3002`                     | Where the backend dispatches sends.                                               |
| `BACKEND_WEBHOOK_URL`   | `http://localhost:3001/api/webhooks/status` | Where the gateway reports status back.                                            |

### Gateway (`@ims/gateway`)

| Variable                  | Default                                     | Meaning                                                                                    |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GATEWAY_PORT`            | `3002`                                      | Gateway port.                                                                              |
| `BACKEND_WEBHOOK_URL`     | `http://localhost:3001/api/webhooks/status` | Status callback URL.                                                                       |
| `GATEWAY_SENDER`          | `simulator`                                 | `simulator` or `applescript`.                                                              |
| `SIMULATOR_SENT_MS`       | `1000`                                      | Simulator: delay before `SENT`.                                                            |
| `SIMULATOR_DELIVERED_MS`  | `3000`                                      | Simulator: delay before `DELIVERED`.                                                       |
| `SIMULATOR_RECEIVED_MS`   | `6000`                                      | Simulator: delay before `RECEIVED`.                                                        |
| `IMESSAGE_DRY_RUN`        | `true`                                      | When `true`, AppleScript mode logs instead of sending. **Safe by default.**                |
| `IMESSAGE_ALLOWLIST`      | _(empty)_                                   | Comma-separated E.164 numbers allowed to receive real messages. Required for live sending. |
| `CHATDB_PATH`             | `~/Library/Messages/chat.db`                | Path to the iMessage database.                                                             |
| `CHATDB_POLL_MS`          | `3000`                                      | How often the delivery watcher polls `chat.db`.                                            |
| `CHATDB_WATCH_TIMEOUT_MS` | `300000` (5 min)                            | How long to watch a message before giving up.                                              |
| `CHATDB_FAIL_ON_TIMEOUT`  | `false`                                     | If `true`, a message never seen in `chat.db` by the timeout is marked `FAILED`.            |

---

## Running the tests

There are **61 tests** across the workspace:

| Package         | Tests | Covers                                                                                         |
| --------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `@ims/shared`   | 11    | Status transitions, Zod schemas, chat.db status/epoch mapping.                                 |
| `@ims/gateway`  | 22    | AppleScript sender + safety lock, chat.db reader (against a SQLite fixture), delivery watcher. |
| `@ims/backend`  | 23    | Repository/queue, scheduler + retry, status service, API, end-to-end flow, stats.              |
| `@ims/frontend` | 5     | Date/time picker, phone masking, form validation.                                              |

Run everything:

```bash
pnpm -r test
```

Or one package at a time:

```bash
pnpm --filter @ims/backend test
pnpm --filter @ims/gateway test
pnpm --filter @ims/frontend test
pnpm --filter @ims/shared test
```

Type-check the whole workspace:

```bash
pnpm -r typecheck
```

### A note on the backend tests

The backend integration tests spin up a disposable PostgreSQL container with **Testcontainers**, so **Docker must be running**. If you would rather point them at an existing Postgres (CI, or a local instance), set `TEST_DATABASE_URL` and the tests will use it instead of starting a container:

```bash
TEST_DATABASE_URL=postgres://ims:ims@localhost:5432/ims pnpm --filter @ims/backend test
```

> `pnpm -r test` is the reliable way to run the full suite. (`turbo run test` sandboxes environment variables, which can starve Testcontainers; wiring the test env into `turbo.json` is a future improvement.)

---

## Business rules and design decisions

This section documents every rule that governs how the system behaves.

### Status lifecycle

A message moves through this state machine:

```
QUEUED → ACCEPTED → SENT → DELIVERED → RECEIVED
   └────────┴─────────┴────────┴──────────► FAILED
```

- `QUEUED` — stored, waiting for its scheduled time and a free throttle window.
- `ACCEPTED` — handed to the gateway (the gateway's `/send` returned successfully).
- `SENT` — the gateway dispatched it (osascript accepted it, or the simulator's timer fired).
- `DELIVERED` — confirmed delivered (from `chat.db`, or simulated).
- `RECEIVED` — confirmed read (from `chat.db` read receipts, or simulated).
- `FAILED` — terminal failure after exhausting retries, or an error reported by `chat.db`.

The allowed transitions and ranks live in `@ims/shared` (`status.ts`). Two properties make the system robust to the messy, out-of-order reality of external delivery callbacks:

- **Forward-only**: a status update is applied only if it represents progress. `RECEIVED` arriving before `DELIVERED` still advances the message; a stale `SENT` after `DELIVERED` is ignored.
- **Idempotent**: re-reporting the same status is a no-op. Gateways can safely retry callbacks.
- **`FAILED` is always reachable** from any non-terminal state (e.g. `chat.db` reporting a delivery error after we already reported `SENT`).

### Scheduling semantics

- **`scheduled_at` means "not before"**, not "exactly at". A message becomes eligible once its scheduled time has passed.
- **Future-only on creation.** The scheduled time must be now or later, with a **60-second tolerance** for clock skew between the browser and server. Past times are rejected with a validation error.

### FIFO queue and the one-per-hour throttle

- **FIFO dispatch.** The scheduler claims the oldest eligible message using `SELECT ... FOR UPDATE SKIP LOCKED`, so concurrent ticks never grab the same row and never block each other.
- **The throttle is global, not per-recipient.** "One message per hour" means the whole system sends at most one message per interval. It is enforced by a single `scheduler_state` row holding the last-dispatch time, read with `FOR UPDATE` inside the same transaction that claims a message.
- **Configurable.** `SEND_INTERVAL_MS` sets the interval. `0` disables the throttle entirely (useful for demos and tests).

### Retries and backoff

- On a gateway send failure, the message is re-queued with **exponential backoff**: the next attempt is delayed by `RETRY_BACKOFF_BASE_MS × 2^(attempt − 1)` with the default base, that is roughly 1 min, then 2 min, then 4 min.
- After `MAX_ATTEMPTS` (default 3) the message becomes `FAILED`, recording the last error.
- **A failed attempt does not consume the throttle window**: a failure should not make the next legitimate message wait an extra hour.

### Phone number validation

- Numbers are normalised to **E.164**. Validation uses `libphonenumber-js`'s `isPossible()` rather than `isValid()`, deliberately, so that reserved test numbers like `+1 (555) …` are accepted for demos. The UI input is restricted to digits and phone punctuation.

### The gateway abstraction

- The gateway exposes a single `MessageSender` interface. Two implementations are selected by `GATEWAY_SENDER`:
  - **`simulator`** (default) — emits `SENT → DELIVERED → RECEIVED` on configurable timers. Runs anywhere, needs no Mac, and powers the integration tests.
  - **`applescript`** — sends a real iMessage and tracks real delivery.
- The gateway has **no database access**. It reports every transition through the backend's status webhook, keeping the backend the single writer.

### The real iMessage path (`applescript` mode)

- **Sending** uses `osascript` driving Messages.app. The recipient and body are passed as **script arguments** (`on run {targetBuddy, messageText}`), never interpolated into the script source, so message content can't break or inject into the AppleScript.
- **Safety lock.** Real sending is gated twice: `IMESSAGE_DRY_RUN` defaults to `true` (so the default behaviour only logs), and live sending **refuses to run unless `IMESSAGE_ALLOWLIST` is non-empty**. Only numbers on the allowlist can receive a message; anything else is rejected before sending.
- **`chat.db` is the source of truth for delivery.** A successful `osascript` exit code means "Messages accepted the command", **not** "delivered". Treating exit code 0 as delivery would be dishonest, so delivery status is reconciled from the database instead:
  - The **reader** (`better-sqlite3`, read-only) joins `message` + `handle`, converts Apple's epoch (nanoseconds since 2001-01-01) to a JS date, and classifies each row. A non-zero `error` column maps to `FAILED`; otherwise read → `RECEIVED`, delivered → `DELIVERED`, sent → `SENT`.
  - The **delivery watcher** polls `chat.db` after a send, matching the outgoing message by recipient handle, body, and a recent timestamp, and reports `DELIVERED`/`RECEIVED`/`FAILED` over the webhook: forward-only, stopping at a terminal status or after `CHATDB_WATCH_TIMEOUT_MS`.
  - Optionally (`CHATDB_FAIL_ON_TIMEOUT=true`), a message that **never appears** in `chat.db` by the timeout is marked `FAILED`: but only when it was never seen, so a slow-but-delivered message is never falsely failed.

### Data model

Three tables (see `apps/backend/src/db/migrations`):

- **`scheduled_messages`** — one row per message, with status, `attempts`, `next_attempt_at`, `last_error`, `gateway_guid`, and timestamps. A partial index on `(scheduled_at, id) WHERE status = 'QUEUED'` keeps queue scans cheap.
- **`message_status_events`** — an **append-only audit log**: every transition, with an optional JSON `detail`. This log, not the current status, is what the analytics are built from.
- **`scheduler_state`** — a singleton row (enforced by a check constraint) holding the throttle clock.

An `updated_at` trigger keeps the row timestamp fresh; the trigger function uses `CREATE OR REPLACE` so re-running migrations is idempotent.

### Dashboard / analytics

`GET /api/stats` is built entirely from the append-only event log using PostgreSQL features:

- **Per-stage timing** via a CTE that pivots each message's events into one timestamp per stage with `MIN(created_at) FILTER (WHERE status = '…')`, then computes inter-stage durations and aggregates the **median and p95** with `percentile_cont`.
- **A delivery funnel** with `COUNT(DISTINCT message_id) FILTER (WHERE status = '…')`.
- **24-hour throughput** with `generate_series` to produce empty buckets and a `LEFT JOIN` onto `SENT` events.

(Postgres returns `numeric`/`EXTRACT` results as strings to preserve precision, so the service coerces them with `Number()` before serialising.)

### Supply-chain hygiene

`.npmrc` sets `minimum-release-age` (don't install packages younger than a day), `save-exact` (pin exact versions), and `engine-strict` (enforce the Node version). Combined with `pnpm-lock.yaml`, installs are reproducible and resistant to fresh malicious releases.

---

## Using the real iMessage gateway (macOS)

> This sends **real messages from your personal iMessage account**. Use the safety lock and tell recipients first.

Test in two stages.

**Stage 1 — dry run (sends nothing).** In `.env`:

```
GATEWAY_SENDER=applescript
IMESSAGE_DRY_RUN=true
```

Restart `pnpm dev`. The gateway log should say `applescript (DRY RUN — not sending, …)`. Schedule a message, it advances to `SENT` and the gateway logs `DRY RUN — would iMessage …`. This validates the whole pipeline safely.

**Stage 2 — live.** Only after stage 1 works:

```
IMESSAGE_DRY_RUN=false
IMESSAGE_ALLOWLIST=+15551234567      # the real E.164 number(s) you will send to
```

Requirements on the Mac:

- **Messages.app open and signed in to iMessage.**
- **Automation permission**: the first real send triggers a macOS prompt to let your terminal/node control Messages, then allow it.
- **Full Disk Access**: the process that runs the gateway needs it to read `~/Library/Messages/chat.db` (System Settings → Privacy & Security → Full Disk Access → add your terminal). Without it, delivery tracking can't read the database, the watcher logs the error and keeps trying until the timeout, and the gateway stays up.

Schedule a message whose recipient is a number on the allowlist. It advances `ACCEPTED → SENT`, and `DELIVERED`/`RECEIVED` follow as `chat.db` confirms them.

---

## Limitations and known caveats

- **A reachable iMessage route is required.** The Mac running the gateway must be able to send iMessage to the recipient. A Mac signed in with **only an email address and no phone number** (e.g. a Mac that has never been paired with an iPhone) has no outgoing route and cannot send, and a Mac alone cannot fall back to SMS. This is an environment limitation, not a code one; the same code sends correctly on a Mac with a working iMessage route.
- **`osascript` exit code is not delivery.** A clean exit means Messages accepted the command. Actual delivery is only known from `chat.db`, which is why status is reconciled from the database.
- **`RECEIVED` is best-effort.** It depends on the recipient having read receipts enabled. Without them, a message legitimately stops at `DELIVERED`.
- **`chat.db` matching is heuristic.** AppleScript's `send` doesn't return the message GUID, so the watcher matches by recipient handle, exact body text, and a recent timestamp.
- **AppleScript automation can be fragile on newer macOS.** Messages scripting has historically broken between releases, and macOS 26 (Tahoe) has reported automation regressions. Development and testing here targeted macOS 15 (Sequoia), which is more stable.

---

## Scripts reference

Run from the repo root:

| Command             | Effect                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Run frontend, backend, gateway, and the shared watcher in parallel. |
| `pnpm build`        | Build every package.                                                |
| `pnpm -r test`      | Run all tests (recommended).                                        |
| `pnpm -r typecheck` | Type-check every package.                                           |
| `pnpm db:migrate`   | Apply migrations to the latest version.                             |
| `pnpm db:reset`     | Drop and re-apply all migrations.                                   |

Per-package scripts (`db:down`, `start`, `preview`, `lint`) are available via `pnpm --filter <name> <script>`.

---

## Project layout

```
.
├─ apps/
│  ├─ backend/      Express API, queue, scheduler, retries, /api/stats
│  ├─ gateway/      Simulator + AppleScript sender, chat.db reader & watcher
│  └─ frontend/     React UI: schedule form, message list, dashboard
├─ packages/
│  └─ shared/       Status state machine, Zod schemas, chat.db mapping, stats DTO
├─ docker-compose.yml   PostgreSQL 16
├─ turbo.json           Task graph
└─ .env.example         Documented configuration template
```
