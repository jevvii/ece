"use client";

import { useFormStatus } from "react-dom";
import { uploadTimeReport } from "./actions";

type PeriodOption = { id: string; label: string };

export function TimeReportUpload({ periods, defaultPeriodId, canWrite }: {
  periods: PeriodOption[]; defaultPeriodId: string; canWrite: boolean;
}) {
  return <form action={uploadTimeReport} className="mt-5">
    <UploadFields periods={periods} defaultPeriodId={defaultPeriodId} canWrite={canWrite} />
  </form>;
}

function UploadFields({ periods, defaultPeriodId, canWrite }: {
  periods: PeriodOption[]; defaultPeriodId: string; canWrite: boolean;
}) {
  const { pending } = useFormStatus();
  return <fieldset disabled={!canWrite || pending || periods.length === 0} aria-busy={pending}>
    <label htmlFor="periodId" className="block text-[13px] font-semibold">Cutoff covered by this file</label>
    <select id="periodId" name="periodId" required defaultValue={defaultPeriodId}
      onChange={(event) => {
        const form = event.currentTarget.form;
        const file = form?.elements.namedItem("file");
        if (file instanceof HTMLInputElement && file.files?.length) form?.requestSubmit();
      }}
      className="mt-2 h-11 w-full rounded-[10px] border border-rule-strong bg-surface px-3 text-[13px]">
      <option value="">Choose a cutoff…</option>
      {periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
    </select>

    <label htmlFor="file" className="mt-5 block text-[13px] font-semibold">Attendance spreadsheet</label>
    <p id="time-file-help" className="mt-1 text-[12.5px] leading-relaxed text-muted">CSV, XLSX or ODS · up to 10 MB. Imports the first worksheet, up to 500 rows and 200 columns.</p>
    <input id="file" name="file" type="file" accept=".ods,.csv,.xlsx" required
      aria-describedby="time-file-help"
      onChange={(event) => { if (event.currentTarget.files?.length) event.currentTarget.form?.requestSubmit(); }}
      className="mt-3 block w-full rounded-[10px] border border-rule-strong bg-surface-2 p-3 text-[13px] text-ink-2 file:mr-3 file:h-9 file:rounded-full file:border file:border-rule-strong file:bg-surface file:px-3 file:text-[13px] file:font-semibold file:text-ink" />
    <p role="status" className="mt-3 text-[12.5px] leading-relaxed text-muted">
      {pending ? "Reading spreadsheet and preparing your preview…" : !canWrite ? "Your role cannot import time reports." : !periods.length ? "No cutoffs available. Update the payroll calendar to import a report." : "The preview opens when you choose a file. Review the columns and employee matches before saving."}
    </p>
    <button type="submit" disabled={!canWrite || pending || periods.length === 0}
      className="mt-5 h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-40">
      {pending ? "Opening preview…" : "Open preview"}
    </button>
  </fieldset>;
}
