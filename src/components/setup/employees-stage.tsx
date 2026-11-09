"use client";

import { useMemo, useState } from "react";
import { EmployeeImport } from "./employee-import";
import {
  blankDraft,
  parsePasteRows,
  rowProblem,
  type EmployeeDraft,
} from "./employee-row";

type Option = { id: string; name: string };

type Existing = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
  tin: string | null;
  birthday: string | null;
  address: string | null;
  hireDate: string;
  separationDate: string | null;
  monthlyRate: string;
  rankName: string | null;
  scheduleName: string | null;
};

const input =
  "h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export function EmployeesStage({
  existing,
  ranks,
  schedules,
  action,
  step,
  from,
  canSetup,
}: {
  existing: Existing[];
  ranks: Option[];
  schedules: Option[];
  action: (formData: FormData) => void | Promise<void>;
  step: number;
  from: "guided" | "admin";
  canSetup: boolean;
}) {
  const [rows, setRows] = useState<EmployeeDraft[]>([]);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const problems = useMemo(() => rows.map(rowProblem), [rows]);
  const blocked = problems.some(Boolean);

  function update(index: number, key: keyof EmployeeDraft, value: string) {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, [key]: value } : row)),
    );
  }

  function applyPaste() {
    const result = parsePasteRows(paste);
    setPasteError(result.error);
    if (!result.error) {
      setRows((current) => [...current, ...result.rows]);
      setPaste("");
    }
  }

  return (
    <div>
      {existing.length > 0 ? (
        <div className="scroll-x mt-6 rounded-[14px] border border-rule">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                {["Code", "Employee", "TIN", "Hired", "Monthly"].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className={`px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted ${
                      heading === "Monthly" ? "text-right" : ""
                    }`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {existing.map((person) => (
                <tr key={person.id} className="border-b border-rule last:border-b-0">
                  <td className="figure px-3 py-2.5 text-[12px] text-ink-2">{person.employeeCode}</td>
                  <td className="px-3 py-2.5 text-[12.5px]">
                    {person.lastName}, {person.firstName}
                  </td>
                  <td className="figure px-3 py-2.5 text-[12px] text-ink-2">{person.tin ?? "—"}</td>
                  <td className="figure px-3 py-2.5 text-[12px] text-ink-2">{person.hireDate}</td>
                  <td className="figure px-3 py-2.5 text-right text-[12.5px]">
                    {peso.format(Number(person.monthlyRate))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">
            Add employees
          </h3>
          <button
            type="button"
            onClick={() => setRows((current) => [...current, blankDraft()])}
            className="h-9 rounded-full border border-rule-strong px-4 text-[12.5px] font-semibold hover:bg-surface-2"
          >
            Add row
          </button>
        </div>

        <EmployeeImport
          canSetup={canSetup}
          onRows={(incoming) => setRows((current) => [...current, ...incoming])}
        />

        <details className="mt-3 rounded-[14px] border border-rule bg-surface-2 px-4 py-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold marker:hidden">
            Paste from a spreadsheet
          </summary>
          <p className="mt-2 text-[12px] leading-[1.6] text-muted">
            Include the header row. Recognised columns: Employee ID, Employee Name (Last, First),
            TIN, Birthday, Address, Date Hired, Date Terminated, Monthly Rate.
          </p>
          <textarea
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            rows={5}
            placeholder={"Employee ID\tEmployee Name\tTIN\tBirthday\tAddress\tDate Hired\tDate Terminated\tMonthly Rate"}
            className="mt-3 w-full rounded-[10px] border border-rule-strong bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
          {pasteError ? (
            <p role="alert" className="mt-2 text-[12px] text-[#7c2523]">{pasteError}</p>
          ) : null}
          <button
            type="button"
            onClick={applyPaste}
            className="mt-3 h-9 rounded-full bg-ink px-4 text-[12.5px] font-semibold text-white hover:opacity-90"
          >
            Preview rows
          </button>
        </details>

        {/* The import panel above owns its own <form>; nesting forms is invalid HTML
            and makes React fail hydration, so the save form starts here. */}
        <form action={action} className="mt-4">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="step" value={step} />
          <input
            type="hidden"
            name="rows"
            value={JSON.stringify(
              rows.map((row) => ({
                ...row,
                monthlyRate: Number(row.monthlyRate || 0),
              })),
            )}
          />

        {rows.length > 0 ? (
          <div className="scroll-x mt-4 rounded-[14px] border border-rule">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["Code", "Employee name", "TIN", "Birthday", "Address", "Hired", "Terminated", "Rate", "Rank", "Schedule", ""].map(
                    (heading, index) => (
                      <th
                        key={`${heading}-${index}`}
                        scope="col"
                        className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b border-rule last:border-b-0">
                    <td className="px-2 py-1.5">
                      <input aria-label={`Code row ${index + 1}`} value={row.employeeCode} onChange={(event) => update(index, "employeeCode", event.target.value)} className={input} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Name row ${index + 1}`} value={row.employeeName} placeholder="Dela Cruz, Maria" onChange={(event) => update(index, "employeeName", event.target.value)} className={input} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`TIN row ${index + 1}`} value={row.tin} onChange={(event) => update(index, "tin", event.target.value)} className={input} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Birthday row ${index + 1}`} type="date" value={row.birthday} onChange={(event) => update(index, "birthday", event.target.value)} className={input} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Address row ${index + 1}`} value={row.address} onChange={(event) => update(index, "address", event.target.value)} className={input} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Hire date row ${index + 1}`} type="date" value={row.hireDate} onChange={(event) => update(index, "hireDate", event.target.value)} className={input} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Termination date row ${index + 1}`} type="date" value={row.separationDate} onChange={(event) => update(index, "separationDate", event.target.value)} className={input} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Monthly rate row ${index + 1}`} type="number" min={0} step="0.01" value={row.monthlyRate} onChange={(event) => update(index, "monthlyRate", event.target.value)} className={`${input} tabular-nums`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Rank row ${index + 1}`} value={row.rankId} onChange={(event) => update(index, "rankId", event.target.value)} className={input}>
                        <option value="">—</option>
                        {ranks.map((rank) => (
                          <option key={rank.id} value={rank.id}>{rank.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Schedule row ${index + 1}`} value={row.scheduleId} onChange={(event) => update(index, "scheduleId", event.target.value)} className={input}>
                        <option value="">Default</option>
                        {schedules.map((schedule) => (
                          <option key={schedule.id} value={schedule.id}>{schedule.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        aria-label={`Remove row ${index + 1}`}
                        onClick={() => setRows((current) => current.filter((_, position) => position !== index))}
                        className="h-8 rounded-full border border-rule-strong px-3 text-[12px] text-muted hover:bg-surface-2"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {rows.length > 0 && blocked ? (
          <p className="mt-3 text-[12px] text-[#7c2523]">
            {problems.find(Boolean)}. Fix the highlighted rows before saving.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
          <p className="text-[12px] text-muted">
            {existing.length + rows.length} employees · codes must be unique and are never reused.
          </p>
          <button
            type="submit"
            disabled={!canSetup || rows.length === 0 || blocked}
            className="h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40"
          >
            Save {rows.length > 0 ? `${rows.length} ` : ""}employee{rows.length === 1 ? "" : "s"}
          </button>
        </div>
        </form>
      </div>
    </div>
  );
}
