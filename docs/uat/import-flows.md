# Import flow UAT

Start the local database with `pg_ctl -D .pgdata -l /tmp/ece-pg.log -o '-p 55432 -k /tmp' start`, apply `pnpm db:migrate`, then run `pnpm dev`. Do not reset the existing database.

Open http://localhost:3000 and sign in as `maria@tala.ph` with `payroll123` (local demo account). Select Bayanihan Trading Corp. in the company switcher for the attendance fixture.

## Employee roster

1. Open `/admin/setup?step=5` and choose `fixtures/employees-sample.csv`. The editable three-row preview appears without another button click.
2. Edit an employee name. Add a manual row, then select the same file again. The imported rows are replaced; the manual row remains. Remove that blank row before saving.
3. Open **Adjust columns and dates**. Change the date order or column assignments. The imported preview refreshes without appending duplicates; these settings replace edits to imported rows.
4. Clear a hire date or repeat an employee code. Saving is disabled and the affected fields are highlighted. Correct the rows and verify saving becomes available.
5. Save only if you intend to add the synthetic employees to this local company. Selecting a file alone does not save employee records.

`fixtures/employees-uat-synthetic.csv` supplies a larger synthetic roster. Both sample files use invented people and payroll details.

## Time report

1. Open `/payroll/time-report`. Select **November 2026 · cutoff 1 · Oct 26 – Nov 10**, then choose `fixtures/sample-attendance.csv`. The spreadsheet opens automatically.
2. Check column assignments. **Column settings** provides keyboard-accessible selectors and a first-data-row field; the sheet also supports pointer selection.
3. Open **Review mapping**. Employee totals use saved code matches and actual work schedules. Match unknown codes to existing employees; the preview updates immediately. No new employee is created by matching a code.
4. Confirm only when issues are resolved. Duplicates, unrecognized values, impossible hours, missing schedules in lateness mode, and mismatched dates block import. Successfully read half-day annotations remain informational.
5. After confirmation, compare the saved hours and lateness with the preview. Reload the run and verify it remains imported.
6. Upload another report for the same cutoff. Confirmation stays disabled until **Replace the previous attendance import** is checked. The older report remains in history as **Replaced**. Approved payroll blocks attendance changes; replacing attendance requires recalculating an existing draft before approval.
7. Try an XLSX or ODS export with attendance on its first worksheet. CSV also accepts semicolon and tab delimiters. Supported bounds are 10 MB, 500 populated rows, and 200 columns. Larger files are rejected rather than partially imported.
8. Test both a desktop viewport and a narrow mobile viewport. Wide employee and attendance tables scroll within their own containers.

An existing unconfirmed report with invalid automatic assignments is detected again when reopened. Valid manual mappings and imported history remain unchanged. For the multi-row attendance layout, verify code column B, name column C, and first data row 8.

## Verification

- `pnpm typecheck`
- `pnpm check:import` — parser, multi-row header and data-start detection, role conflicts, preview recovery, validation and arithmetic regressions
- `pnpm check:payroll` — unchanged payroll calculation behavior
- `pnpm check:browser` — application routes, automatic employee preview, replacement and field validation
- `node scripts/check-time-import.mjs` — local-only synthetic attendance import, aliases, schedules, custom data start, preview/save parity and duplicate blocking, replacement history, and approval locks; removes its test runs afterward. Requires the sample cutoff to have no imported attendance.
- `pnpm build`

The time report uses the first worksheet. Saved profiles retain column assignments for reference; automatic reuse and source-total reconciliation are outside this change. Supabase storage installations must allow the XLSX MIME type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` in the private uploads bucket before accepting XLSX uploads.

Changes are developed and committed on `feat/import-flow-optimization`, based on `feat/payroll-engine-correctness`, then merged into local `staging`. The user approved including the existing 18-commit setup/import/payroll stack. No remote push or deployment is part of this task.
