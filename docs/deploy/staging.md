# Staging deployment — Render + Supabase

Staging exists for three jobs: rehearsing what will ship, day-to-day pre-production
testing, and showing payroll to the accountant. It therefore stores data the way
production will, not the way is convenient.

| Piece | Where it lives |
| --- | --- |
| App | Render web service `ece-staging`, deployed from the `staging` branch |
| Database | Supabase Postgres (session pooler) |
| Uploaded ODS/CSV | Supabase Storage bucket `ece-uploads` (private) |
| Auth | In-app — scrypt hashes and the `sessions` table. No Supabase Auth |

Everything is declared in [`render.yaml`](../../render.yaml); the runbook below is
what you have to do once.

> **Do not put real client data in staging.** Row-level security is not applied,
> every session shares one password scheme, and `PH-2026.1` statutory rates are
> still unapproved. The seed is synthetic and must stay that way.

## 1. Create the Supabase project

1. New project → name `ece-staging`, region **Southeast Asia (Singapore)** to match
   the Render region, and save the database password somewhere safe.
2. **Storage → New bucket** → name `ece-uploads`, with these settings:
   - **Public:** off. Nothing is served to a browser; the app reads files
     server-side with the service-role key.
   - **File size limit:** `12MB`. This is a backstop, deliberately *above* the
     app's own 10 MiB check — the app measures 10 × 1024 × 1024, while Supabase
     parses `12MB` as 12,000,000, so an exact `10MB` here would reject files the
     app considers valid.
   - **Allowed MIME types:** `text/csv` and
     `application/vnd.oasis.opendocument.spreadsheet`.
   - Leave policies empty. The service-role key bypasses RLS and is only ever
     used server-side; these bucket limits are enforced by the Storage API for
     every upload regardless of key.
   Do not add policies; an empty bucket with no policies is correct.
3. **Project Settings → API** → copy:
   - Project URL → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` *(never ship this to a
     browser or commit it)*
4. **Project Settings → Database → Connection string → Session pooler**, port
   **5432** → `DATABASE_URL`.

> Use the session pooler, not the direct `db.<ref>.supabase.co` host. The direct
> host is IPv6-only and Render cannot reach it. Use 5432, not the 6543 transaction
> pooler, because migrations run DDL inside the build.

The connection string looks like:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

## 2. Prepare the repository

The remote is `origin → https://github.com/jevvii/ece.git`.

```bash
git push -u origin main
git checkout -b staging
git push -u origin staging
```

`main` is the clean, shippable line. `staging` is the long-lived integration
branch Render watches. Work happens on feature branches, merges into `staging`,
and only reaches `main` once it has been exercised on staging.

## 3. Create the Render service

1. Render dashboard → **New → Blueprint** → connect `jevvii/ece`.
2. Render reads `render.yaml` and proposes one web service, `ece-staging`.
3. Fill the three `sync: false` values when prompted — `DATABASE_URL`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Everything else is in the file.
4. **Apply**. The first build runs `pnpm db:migrate` before `pnpm build`, creating
   every table in the new Supabase database.

The service is `plan: starter` ($7/mo) on purpose. Free instances spin down after
15 minutes of inactivity, which makes an accountant walkthrough wait on a cold
start and turns the health check into noise. Switch to `free` in `render.yaml` if
you want to trade that away.

## 4. Seed the demo data — once

Migrations are idempotent and run on every deploy. The seed is **not** in the
build command, because it either no-ops or wipes data. Run it by hand, exactly
once, from the Render shell (or any machine with `DATABASE_URL` exported):

```bash
pnpm db:seed
```

Use `pnpm db:reset` only when you deliberately want to rebuild the demo tenants.
It refuses to run against a populated database unless you pass `--reset`.

Demo sign-in: `maria@tala.ph`, `jose@bayanihan.ph`, or `ana@tala.ph`, password
`payroll123`.

## 5. Verify

```bash
curl -fsS https://<service>.onrender.com/api/health
# {"ok":true,"database":"up"}
```

`/api/health` is the only unauthenticated route (it is excluded in
`src/proxy.ts`). It runs `select 1`, so a bad `DATABASE_URL` fails the deploy
instead of reaching users.

Then, signed in:

1. Switch between the two demo companies in the header.
2. Upload an ODS/CSV time report — this exercises Supabase Storage.
3. **Trigger a redeploy**, then reopen the same time-report run. The file must
   still preview. If it does not, storage is falling back to local disk — check
   that `STORAGE_BACKEND=supabase` and both Supabase values are set.

That third step is the one that matters: it is the difference between this
environment rehearsing production and merely resembling it.

## Environment variables

| Key | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Supabase session pooler, `:5432` | secret |
| `STORAGE_BACKEND` | `supabase` | `local` in development |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | secret |
| `SUPABASE_SERVICE_ROLE_KEY` | service role secret | secret, server-only |
| `SUPABASE_STORAGE_BUCKET` | `ece-uploads` | must already exist |
| `NODE_ENV` | `production` | enables secure session cookies |

Locally, omit the Supabase values and uploads keep using `.data/uploads`.

## Operational notes

- **Rollback** is Render's deploy history → *Rollback*. It restores the previous
  build; it does **not** reverse migrations. For a staging environment, prefer
  rolling forward with a new migration.
- **Node version** is pinned to 24 in `.node-version` and `package.json#engines`.
  Next.js 16 requires ≥ 20.9.
- **Uploads are capped at 10 MB** in the action; `serverActions.bodySizeLimit` is
  `12mb` to leave room for multipart overhead.
- **Supabase free tier pauses** a project after about a week without queries. If
  the accountant opens staging cold, expect the first request to fail and retry.
- **No worker runs.** The README mentions a "web + worker" target, but there is no
  queue code yet; adding one is a separate change.
