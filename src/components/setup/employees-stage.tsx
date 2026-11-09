"use client";

import { useMemo, useState } from "react";

type Draft = {
  employeeCode: string;
  employeeName: string;
  tin: string;
  birthday: string;
  address: string;
  hireDate: string;
  separationDate: string;
  monthlyRate: string;
  rankId: string;
  scheduleId: string;
};

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
const label = "block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function blank(): Draft {
  return {
    employeeCode: "",
    employeeName: "",
    tin: "",
    birthday: "",
    address: "",
    hireDate: "",
    separationDate: "",
    monthlyRate: "",
    rankId: "",
    scheduleId: "",
  };
}

function normaliseHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function normaliseDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, month = "", day = "", year = ""] = slash;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return trimmed;
}

const HEADERS: Record<string, keyof Draft> = {
  employeeid: "employeeCode",
  employeecode: "employeeCode",
  code: "employeeCode",
  id: "employeeCode",
  employeename: "employeeName",
  name: "employeeName",
  tin: "tin",
  birthday: "birthday",
  birthdate: "birthday",
  dateofbirth: "birthday",
  address: "address",
  datehired: "hireDate",
  hiredate: "hireDate",
  hired: "hireDate",
  dateterminated: "separationDate",
  separationdate: "separationDate",
  terminated: "separationDate",
  monthlyrate: "monthlyRate",
  rate: "monthlyRate",
  salary: "monthlyRate",
};

function parsePaste(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { rows: [] as Draft[], error: "Paste a header row and at least one employee row." };
  }

  const headerLine = lines[0] ?? "";
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const headers = headerLine.split(delimiter).map((header) => HEADERS[normaliseHeader(header)]);

  if (!headers.includes("employeeCode") || !headers.includes("employeeName")) {
    return {
      rows: [] as Draft[],
      error: "The header needs an Employee ID and an Employee Name column.",
    };
  }

  const rows = lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const draft = blank();
    headers.forEach((key, index) => {
      if (!key) return;
      const value = (cells[index] ?? "").trim();
      if (key === "birthday" || key === "hireDate" || key === "separationDate") {
        draft[key] = normaliseDate(value);
      } else if (key === "monthlyRate") {
        draft.monthlyRate = value.replace(/[₱,\s]/g, "");
      } else {
        draft[key] = value;
      }
    });
    return draft;
  });

  return { rows, error: null as string | null };
}

function rowProblem(row: Draft) {
  if (!row.employeeCode.trim()) return "Code missing";
  if (!row.employeeName.includes(",")) return "Name must be \"Last, First\"";
  if (!row.hireDate) return "Hire date missing";
  if (!row.monthlyRate || Number.isNaN(Number(row.monthlyRate))) return "Rate missing";
  return null;
}

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
  const [rows, setRows] = useState<Draft[]>([]);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const problems = useMemo(() => rows.map(rowProblem), [rows]);
  const blocked = problems.some(Boolean);

  function update(index: number, key: keyof Draft, value: string) {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, [key]: value } : row)),
    );
  }

  function applyPaste() {
    const result = parsePaste(paste);
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

      <form action={action} className="mt-6">
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

        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">
            Add employees
          </h3>
          <button
            type="button"
            onClick={() => setRows((current) => [...current, blank()])}
            className="h-9 rounded-full border border-rule-strong px-4 text-[12.5px] font-semibold hover:bg-surface-2"
          >
            Add row
          </button>
        </div>

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
  );
}
