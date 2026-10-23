# ponytail.md — Project Guidance

Persistent project context for **Indonesia Trade Intelligence** (`indonesia-trade-intelligence`).
Read this at the start of every task. Keep it updated when architecture, dependencies,
conventions or module structure change. It is context, not a substitute for reading the code.

> Never put secrets here (passwords, API keys, tokens, real `.env` values).

## Purpose

Analytics for Indonesia's international goods trade (reporter `360` / IDN).
Official data comes from the **UN Comtrade Free API**, is stored in **PostgreSQL**, processed
through **Redis + BullMQ** workers, and read by a **Next.js** dashboard and generated
**Excel workbooks**.

- The Excel workbook is the primary deliverable; the web dashboard is secondary.
- The dashboard reads PostgreSQL only — it never calls UN Comtrade when filters change.
- Coverage targets: annual 2020–2025 and monthly Jan–Aug 2026 (plus a cumulative `2026M01-08` period).

## Current status (as of 2026-10-20)

- No `COMTRADE_API_KEY` in the repo. Without one the system runs on deterministic fixture data
  marked `sourceKind = FIXTURE`. That data is **not** official UN Comtrade statistics.
- The live historical backfill has not been run against the real API, so official coverage is empty.
- `scripts/switch-to-comtrade.ts` removes fixture data and starts the live backfill once a key exists.

## Technology stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js ≥ 20.18 (`.nvmrc`: 22; Docker image `node:22-alpine`) |
| Language | TypeScript 5.9, strict (`tsconfig.base.json`: `noUnusedLocals`, `noUnusedParameters`, etc.) |
| Monorepo | npm workspaces: `apps/*`, `packages/*`, `workers/*` |
| Web | Next.js 15 App Router, React 19, Tailwind 3, TanStack Query + Table, Recharts, lucide-react, CVA/clsx/tailwind-merge |
| Database | PostgreSQL 16 via Prisma 6 (`packages/database/prisma/schema.prisma`) |
| Queue | Redis 7, BullMQ 5, ioredis |
| Excel | exceljs + hand-written OOXML (native charts), jszip for multi-workbook packages |
| Numbers | decimal.js for monetary values (avoid float math on trade values) |
| Validation | zod (`packages/shared/src/schemas.ts`) |
| Tests | Vitest 3 (`packages/**/*.test.ts`, `tests/**/*.test.ts`), fast-check available |
| Deploy | Docker Compose: postgres, redis, migrate, web, worker, exports, scheduler, nginx |

## Module map

### `packages/` (internal libraries, consumed as TS source via `exports: ./src/index.ts`)

- **`@iti/shared`** — constants (`REPORTER`, quota limits, `QUEUE_NAMES`, periods, HS levels,
  completeness statuses), calculations, HS helpers, id helpers, zod schemas, logger, Redis URL parsing.
  No dependency on other internal packages.
- **`@iti/database`** — Prisma client (`getPrisma`, `disconnectPrisma`), observation batch
  preparation, persistence/upserts, summary refresh, completeness. Schema, migrations and seed live in `prisma/`.
- **`@iti/comtrade`** — UN Comtrade client, Redis rate limiter, backfill planner (partition splitting
  under `maxRecords`), normalization, fixture source, partition execution, queue helpers,
  bundled reference data (`reference/partners.json`).
- **`@iti/analytics`** — read queries and dashboard view models for the web app. `getTradeView` serves both the
  dashboard and the partner page; pure helpers (`parsePeriods`, `togglePeriod`, `sumPeriods`) live in `dashboard-view.ts`.
- **`@iti/excel`** — workbook model, sheet builders, OOXML charts, `generateExportPackage`.

Dependency direction: `shared` ← `database` ← (`comtrade`, `analytics`, `excel`) ← apps/workers.

### `apps/web` (`@iti/web`)

- `src/app/(app)/` — authenticated pages: dashboard, countries (+ `[code]`), commodities, compare,
  coverage, reports (generate, history), admin/synchronization.
- `src/app/api/` — route handlers: auth login/logout, health, admin sync, countries children, reports + download.
- `src/middleware.ts` — HMAC cookie session check; public paths are `/login`, `/api/auth/login`, `/api/health`.
- `src/components/`, `src/lib/` (auth, session, utils).

### `workers/`

- **ingestion** — BullMQ workers for all `SYNC_QUEUES` (concurrency 1), uses `ComtradeClient` or fixture source.
- **scheduler** — periodic tick with a Redis lock (`iti:scheduler:lock`); respects pause flag and
  rolling quota; enqueues pending `SyncJob` rows.
- **exports** — consumes `excel-generation` jobs and writes files to `EXPORT_STORAGE_PATH`.

### Other

- `scripts/` — `switch-to-comtrade.ts`, `enqueue-world-totals.ts`, `backup.sh`, `restore.sh`.
- `infrastructure/nginx/nginx.conf` — the only service with a published port in production.
- `docs/` — `DEPLOYMENT.md`, `PANDUAN-PENGGUNA.md` (user guide), `BACKUP.md`.
- `exports/` — local generated output (git-ignored).

## Key domain rules and decisions

- **Quota safety:** provider cap is 500 calls/day and 1 req/s. The configured budget is 450/day
  and a 1500 ms interval, so there is headroom for manual checks and retries. The quota window is a
  rolling 24 h, **not** reset at WIB midnight. Never raise client limits above provider limits.
- **Missing ≠ zero:** absent values are written as `n.a.` in Excel, never `0`.
- **Data provenance:** every observation/summary carries `sourceKind` (`FIXTURE` vs `UN_COMTRADE`);
  fixture data must stay clearly labelled.
- **HS hierarchy:** HS2 → HS4 → HS6 → HS8 (HS8 when available; status may be `UNVERIFIED`).
- **Excel layout:** `01 DASHBOARD` (dropdowns, formula KPIs, native charts), `02 SUMMARY ALL COUNTRIES`,
  one sheet per partner with HS outline, `04 COVERAGE`. Oversized output becomes a zip with several
  workbooks plus `MANIFEST.json`.
- **Network isolation:** Postgres and Redis have no public ports in production; services talk by
  Compose service name. `docker-compose.dev.yml` exposes them on `127.0.0.1:55432` / `56379` for host development.
- **Secrets:** `COMTRADE_API_KEY` is server-side only; `.env` is git-ignored; `.env.example` holds placeholders.

## Coding conventions

- Strict TypeScript, ES modules, `moduleResolution: Bundler`. No unused locals/params.
- Import internal packages by name (`@iti/shared`, …); each package re-exports from `src/index.ts`.
- Prisma access through `getPrisma()`; functions take an optional `prisma` argument for testability.
- Logging through `logger` from `@iti/shared` with a message plus a structured context object.
- Workers handle `SIGTERM`/`SIGINT` gracefully (close workers, disconnect Prisma).
- User-facing text (UI, errors, Excel labels, docs) is in **Indonesian**; code identifiers and code comments in English.
- Tests use fixtures and must never spend UN Comtrade quota.

## Web design system — "Sistem Nila–Soga" (since 2026-10-21)

Chosen by the user from three huashu-design directions (`design-demos/`, approval in `design-demos/direction-approved.md`).

- Colour encodes trade flow only: export = nila/tarum `oklch(0.42 0.09 262)`, import = soga `oklch(0.56 0.10 58)`, balance = ink.
  Tokens live as oklch channels in `apps/web/src/app/globals.css` and are exposed through Tailwind (`bg-nila`, `bg-soga`, `text-ink/60`…).
  Legacy token names (`pine`, `copper`, `moss`, `clay`) are aliased to the new palette.
- Type: Hanken Grotesk (body) + Schibsted Grotesk (`font-display`, headings and KPI numbers with proportional figures); tables use tabular figures.
- No cream background, no serif display, no shadows, no left-accent cards, no emoji icons (the old look was the "Warm Editorial" AI default).
- Layout: thin top nav (`components/shell.tsx`); analytic pages use `RailLayout` = white left filter rail + hairline-separated panels.
  Building blocks are in `components/trade-sections.tsx` (`KpiBand`, `Panel`, `CompositionStacks` 100% bars, `HBars`, `CommodityTables`).
- Recharts only for annual charts (`components/charts.tsx`), straight lines, flow colours.

## Development workflow

```sh
cp .env.example .env          # fill in placeholders locally; never commit
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
npm install                   # postinstall runs prisma generate
npm run db:migrate
npm run db:seed
npm run dev                   # http://localhost:3000/login
```

Checks before finishing a change:

```sh
npm test
npm run typecheck
npm run build
```

Workers locally: `npm run worker:ingestion`, `npm run worker:scheduler`, `npm run worker:exports`.
Production stack: `npm run docker:up` (see `docs/DEPLOYMENT.md`).

When adding a workspace package: add it to the `typecheck` script, the Vitest alias map, and the Dockerfile `COPY` list.

## Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-20 | Created `ponytail.md` as project documentation (not an external tool). | No package or tool by that name in dependencies or docs; it serves as persistent project guidance. |
| 2026-10-20 | Excel dashboard World composition and growth are computed from **all** partners (`levelTotals` in `WorkbookInput`, world SQL in `generate.ts`), not only partners in the export. | Review "Repisi": a one-country export (Antigua) produced a World composition/ranking that disagreed with the website. |
| 2026-10-21 | Website redesigned to "Sistem Nila–Soga" (huashu-design skill, direction 1, Otl Aicher logic); donuts replaced by 100% stacked bars. | User asked for an anti-AI-slop redesign; the previous cream/serif/terracotta look was the AI default. |
| 2026-10-21 | `next.config.ts` reads optional `NEXT_DIST_DIR`; a second dev server can use `.next-dev` (git-ignored). | Running `next dev` beside `next start` must not overwrite the production `.next` build. |
| 2026-10-21 | Excel dashboard: KPI cards in `D5:E12` (Total ekspor D6, Total impor D8, Surplus/defisit D10, Pertumbuhan % D12); the 10 export-destination / 10 import-origin tables and their `_RANK_*` helper sheets were removed; the growth chart is titled "Top 5 komoditas dengan kenaikan tertinggi YoY (%)" and takes the old "Perbandingan negara" slot. | Second revision of the "Repisi" review doc. |
| 2026-10-20 | Excel "Perbandingan negara" chart removed; composition charts are pies whose category text (built in `_VIEW` col C with `FIXED`) carries HS code, description, value and %. | Excel applied the label number format to percentages ("0,2"); `FIXED` follows the local decimal separator, `TEXT` does not. |
| 2026-10-20 | Excel trend and "Kinerja" charts both plot every available year (same range as the website); the Ya/Tidak year picker drives KPIs, tables and composition only. | Review flagged mismatched year ranges between the two charts. |
| 2026-10-20 | Website: `getTradeView` (analytics) is the single query for Dasbor and Negara Mitra: country (`"0"` = World), several periods (`?periods=2023,2024`), HS level, optional HS code. Multi-period totals become n.a. if any period is missing. | Review asked for country/HS filters and multi-select years; one function keeps both pages consistent. |
