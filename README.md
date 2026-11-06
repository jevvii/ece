# ECE Accounting

Enterprise accounting and payroll for Philippine businesses. Payroll is the first
deliverable; the other eight modules share the same company, chart of accounts and
audit trail.

**Status: payroll complete — all seven apps are functional end to end.**
Time Report → Payroll Computation (register + approval) → Payslip → Payroll Journal,
plus Leaves, Annualization and 2316. The statutory dataset is still unapproved, and
the 2316 prints on the official BIR Form 2316 PDF.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript strict |
| Data | PostgreSQL + Drizzle ORM |
| Styling | Tailwind v4 with tokens in `src/app/globals.css` |
| Type | Instrument Sans / Instrument Serif, IBM Plex Mono for figures |
| PDF (next) | `@react-pdf/renderer` for payslips, `pdf-lib` overlay for BIR 2316 |
| Deploy target | Render (web + worker) + Supabase Postgres/Storage/Auth |

## Interface

The workspace shares the onboarding language: white canvas, ink `#131310`, a
single green signal `#0C7A43`, 14px cards, 10px fields, pill actions and Instrument
Sans/Serif. Money and codes stay in IBM Plex Mono with tabular numerals; small
labels sit one step larger than the first build for readability. There are no
gradients or decorative shadows; hover is a 200ms colour change and a 1px lift.

The palette, two alternatives (Harbor Blue, Clay & Graphite) and the rules for
using them are in [`docs/design/palette.md`](docs/design/palette.md). All tokens
live in the `@theme` block of `src/app/globals.css`.

## Local setup

A project-owned Postgres cluster lives in `.pgdata` on port **55432**, so no
system database or Docker is required. Production uses `DATABASE_URL` from
Supabase instead.

```bash
pnpm install
initdb -D .pgdata -U ece --auth=trust --encoding=UTF8 --locale=C   # first time only
pg_ctl -D .pgdata -l /tmp/ece-pg.log -o "-p 55432 -k /tmp" start
createdb -h 127.0.0.1 -p 55432 -U ece ece_dev                     # first time only
cp .env.example .env.local

pnpm db:migrate
pnpm db:reset     # demo tenants, 2026 cutoffs, 13 synthetic employees
pnpm dev
```

Demo sign-in: `maria@tala.ph`, `jose@bayanihan.ph`, or `ana@tala.ph` — password
`payroll123`. Maria is the bureau identity with memberships in both companies.

## Deployment

Staging is a Render web service deployed from the `staging` branch, backed by
Supabase Postgres and a private Supabase Storage bucket for uploaded time reports.
Migrations run in Render's build step; the demo seed is run once by hand. The full
runbook — Supabase setup, Render blueprint, verification, and branch workflow — is
in [`docs/deploy/staging.md`](docs/deploy/staging.md).

## What M1 implements

- **Tenancy.** One tenant is one legal company. A firm (bureau) holds memberships
  across companies; the header switches companies without a second login. Three
  seats per company; employee records never consume a seat.
- **Auth.** Database-backed sessions, scrypt password hashes, `proxy.ts` route
  guard. Replaceable with Supabase Auth in production.
- **First-run payroll onboarding** (`/payroll/onboarding`). When a company has no
  active cutoff calendar — a fresh start or a setup restart — Payroll redirects into
  a four-question guided flow (divisor, cutoff, workweek, review) styled after the
  MicroAxis preview-3 direction: white canvas, Instrument Sans/Serif, a single green
  accent, one decision per screen. Finishing creates the calendar and schedule and
  marks setup complete. Admin setup remains available for edits.
- **Company setup wizard** (`/admin/setup`), 10 stages defined, 4 built:
  1. company identity, salary divisor (26/22/30) with live daily and hourly rates
  2. cutoff calendar — 26–10 / 11–25, 1–15 / 16–EOM, or custom; generates 24
     periods with inclusive coverage dates, separate paydays and cutoff-ending
     cycle labels
  3. per-weekday work schedules with unpaid breaks
  4. employee master, stable company codes, derived daily rate
- **Restart setup** archives the active calendar and schedules, increments
  `setupVersion`, and requires the typed word `RESTART`. Nothing is deleted.
- **Honest states.** Payroll apps show "No runs yet" rather than simulated data.

## Deliberate boundaries

- `reference/` holds client source documents (ODS attendance export, payslip PDF).
  It is gitignored and must never be committed or seeded. Demo data is synthetic.
- Row-level security policies are **not yet applied**. Every query is scoped by
  `tenant_id` in the data layer; Postgres RLS is the next hardening step before
  anything is exposed publicly.
- The statutory dataset `PH-2026.1` is recorded as pending accountant approval.
  No rate is treated as filing-authoritative.

## M2 — Time Report

- **Parser.** ODS is read directly from `content.xml` (merged cells, repeated
  columns, cached values); CSV uses an RFC 4180 parser. XLSX is not wired yet.
- **Detection.** Finds the employee-code column, the day-header row by counting
  *distinct* days (a data row full of `8`s must not win), the name column, and
  the premium/total columns. It suggests a unit from the data: a whole number
  above 24 in a day can only be tenths of an hour or minutes.
- **Mapping review.** Every column gets a role — ignore, code, name, day, bucket,
  or source total. The day unit is confirmed before import. Nothing is written
  until the officer confirms.
- **Employee binding.** Unknown external codes are listed with the name printed
  in the file. Binding a code creates a reviewed alias; names never create an
  employee.
- **Idempotent re-import.** Confirming again replaces that run's days and buckets
  rather than appending. Every run keeps its mapping, issues and profile.
- **Attendance grid.** Hours per employee per day, day columns sorted by real
  date inside the cutoff, with premium-bucket totals.

Run the engine checks with `pnpm check:import`. They parse the synthetic fixture
in `fixtures/` and, when present, the real ODS in `reference/`.

Known limits: XLSX, source-total reconciliation (the `Present` column is mapped
but not yet compared), per-bucket units (assumed hours), and profile reuse on a
new upload are still to come.
