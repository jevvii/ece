"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { parseEmployeeFileAction, type ParseWorkbookState } from "@/lib/setup/actions";
import {
  blankDraft,
  dateOrderLabel,
  inferDateOrder,
  normaliseDate,
  normaliseRate,
  type DateOrder,
  type EmployeeDraft,
} from "./employee-row";

const initial: ParseWorkbookState = { status: "idle" };

type FieldKey =
  | "ignore"
  | "employeeCode"
  | "employeeName"
  | "lastName"
  | "firstName"
  | "tin"
  | "birthday"
  | "address"
  | "hireDate"
  | "separationDate"
  | "monthlyRate";

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "ignore", label: "Ignore" },
  { key: "employeeCode", label: "Employee ID / code" },
  { key: "employeeName", label: "Employee name (Last, First)" },
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "tin", label: "TIN" },
  { key: "birthday", label: "Birthday" },
  { key: "address", label: "Address" },
  { key: "hireDate", label: "Date hired" },
  { key: "separationDate", label: "Date terminated" },
  { key: "monthlyRate", label: "Monthly rate" },
];

const ALIASES: Record<string, FieldKey> = {
  employeeid: "employeeCode",
  employeeidnumber: "employeeCode",
  employeecode: "employeeCode",
  code: "employeeCode",
  id: "employeeCode",
  employeename: "employeeName",
  fullname: "employeeName",
  name: "employeeName",
  lastname: "lastName",
  surname: "lastName",
  firstname: "firstName",
  givenname: "firstName",
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
  basicsalary: "monthlyRate",
};

function normaliseHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function matchHeader(value: string): FieldKey {
  return ALIASES[normaliseHeader(value)] ?? "ignore";
}

function autoMap(header: string[]): FieldKey[] {
  const seen = new Set<FieldKey>();
  return header.map((cell) => {
    const field = matchHeader(cell);
    if (field === "ignore" || seen.has(field)) return "ignore";
    seen.add(field);
    return field;
  });
}

function findHeaderRow(rows: string[][]) {
  let best = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const score = (rows[index] ?? []).filter((cell) => matchHeader(cell) !== "ignore").length;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

const select =
  "h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

export function EmployeeImport({
  onRows, onBusy, canSetup,
}: {
  onRows: (rows: EmployeeDraft[]) => void;
  onBusy: (busy: boolean) => void;
  canSetup: boolean;
}) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [dateOrder, setDateOrder] = useState<DateOrder>("mdy");

  function configure(rows: string[][], header = findHeaderRow(rows)) {
    setHeaderRow(header);
    setMapping(autoMap(rows[header] ?? []));
    setDateOrder(inferDateOrder(rows.slice(header + 1, header + 40).flat()));
  }

  const [state, formAction, pending] = useActionState(async (previous: ParseWorkbookState, formData: FormData) => {
    try {
      const result = await parseEmployeeFileAction(previous, formData);
      setSheetIndex(0);
      configure(result.sheets?.[0]?.rows ?? []);
      return result;
    } catch {
      return { status: "error", error: "Could not read the file. Choose it again to retry." } satisfies ParseWorkbookState;
    } finally {
      onBusy(false);
    }
  }, initial);
  const sheets = state.status === "ok" ? state.sheets ?? [] : [];
  const sheet = sheets[sheetIndex];

  const preview = useMemo(() => {
    if (!sheet) return [] as EmployeeDraft[];

    return sheet.rows
      .slice(headerRow + 1)
      .map((row) => {
        const values: Partial<Record<FieldKey, string>> = {};
        mapping.forEach((field, column) => {
          if (field === "ignore") return;
          const value = (row[column] ?? "").trim();
          if (value) values[field] = value;
        });

        const draft = blankDraft();
        draft.employeeCode = values.employeeCode ?? "";

        const last = values.lastName ?? "";
        const first = values.firstName ?? "";
        draft.employeeName =
          values.employeeName ?? (last && first ? `${last}, ${first}` : last || first);

        draft.tin = values.tin ?? "";
        draft.address = values.address ?? "";
        draft.birthday = normaliseDate(values.birthday ?? "", dateOrder);
        draft.hireDate = normaliseDate(values.hireDate ?? "", dateOrder);
        draft.separationDate = normaliseDate(values.separationDate ?? "", dateOrder);
        draft.monthlyRate = normaliseRate(values.monthlyRate ?? "");
        return draft;
      })
      .filter((row) => row.employeeCode || row.employeeName);
  }, [sheet, headerRow, mapping, dateOrder]);

  const missingRequired =
    !mapping.includes("employeeCode") ||
    (!mapping.includes("employeeName") &&
      !mapping.includes("lastName") &&
      !mapping.includes("firstName"));

  const mappedFields = mapping.filter((field) => field !== "ignore");
  const duplicateMapping = new Set(mappedFields).size !== mappedFields.length;
  useEffect(() => {
    if (!pending) onRows(missingRequired || duplicateMapping ? [] : preview);
  }, [preview, missingRequired, duplicateMapping, pending, onRows]);

  return (
    <section aria-label="Import employees" className="mt-4 border-y border-rule py-5">
      <form action={formAction} onSubmit={() => { onRows([]); onBusy(true); }}>
        <label htmlFor="employee-file" className="block text-[13px] font-semibold">Import a spreadsheet</label>
        <p id="employee-file-help" className="mt-1 text-[12.5px] text-muted">
          Choose a CSV, XLSX or ODS file to preview employees. Up to 5 MB.
        </p>
        <input
          id="employee-file"
          name="file"
          type="file"
          accept=".csv,.xlsx,.ods"
          required
          disabled={!canSetup || pending}
          aria-describedby="employee-file-help"
          onChange={(event) => { if (event.target.files?.length) event.currentTarget.form?.requestSubmit(); }}
          className="mt-3 block w-full text-[13px] file:mr-3 file:h-10 file:rounded-full file:border file:border-rule-strong file:bg-surface file:px-4 file:text-[13px] file:font-semibold file:text-ink disabled:opacity-40"
        />
        <p role="status" className="mt-2 text-[12.5px] text-muted">
          {pending ? "Reading spreadsheet…" : sheet ? `${state.fileName} · ${preview.length} employees in preview` : "Your file opens in an editable preview below."}
        </p>
      </form>

      {state.status === "error" ? (
        <p role="alert" className="mt-3 text-[12px] text-[#7c2523]">{state.error}</p>
      ) : null}

      {sheet && !pending ? (
        <div className="mt-4">
          <details>
            <summary className="cursor-pointer text-[13px] font-semibold">Adjust columns and dates</summary>
            <p className="mt-2 text-[12.5px] text-muted">Changing these settings refreshes the imported rows and replaces any edits to them.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="import-sheet" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Sheet
              </label>
              <select
                id="import-sheet"
                value={sheetIndex}
                onChange={(event) => { const index = Number(event.target.value); setSheetIndex(index); configure(sheets[index]?.rows ?? []); }}
                className={select}
              >
                {sheets.map((entry, index) => (
                  <option key={`${entry.name}-${index}`} value={index}>{entry.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="import-header" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Header row
              </label>
              <select
                id="import-header"
                value={headerRow}
                onChange={(event) => configure(sheet.rows, Number(event.target.value))}
                className={select}
              >
                {sheet.rows.slice(0, Math.min(sheet.rows.length, 25)).map((row, index) => (
                  <option key={index} value={index}>
                    Row {index + 1}{row.slice(0, 3).join(" · ") ? ` · ${row.slice(0, 3).join(" · ").slice(0, 40)}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="import-dates" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Date order
              </label>
              <select
                id="import-dates"
                value={dateOrder}
                onChange={(event) => setDateOrder(event.target.value as DateOrder)}
                className={select}
              >
                {(Object.keys(dateOrderLabel) as DateOrder[]).map((order) => (
                  <option key={order} value={order}>{dateOrderLabel[order]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="scroll-x mt-4 rounded-[14px] border border-rule bg-surface">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["Column", "Sample", "Map to"].map((heading) => (
                    <th key={heading} scope="col" className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(sheet.rows[headerRow] ?? []).map((cell, column) => (
                  <tr key={column} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-2 text-[12.5px] font-medium">{cell || `Column ${column + 1}`}</td>
                    <td className="px-3 py-2 text-[12px] text-muted">
                      {(sheet.rows[headerRow + 1]?.[column] ?? "").slice(0, 40)}
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        aria-label={`Map ${cell || `column ${column + 1}`}`}
                        value={mapping[column] ?? "ignore"}
                        onChange={(event) =>
                          setMapping((current) =>
                            current.map((value, position) =>
                              position === column ? (event.target.value as FieldKey) : value,
                            ),
                          )
                        }
                        className={select}
                      >
                        {FIELDS.map((field) => (
                          <option key={field.key} value={field.key}>{field.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          </details>

          {missingRequired ? (
            <p className="mt-3 text-[12px] text-[#7c2523]">
              Map a column to Employee ID and one to Employee Name (or Last and First name).
            </p>
          ) : null}

          {duplicateMapping ? <p role="alert" className="mt-3 text-[13px] text-[#7c2523]">Each employee field can use only one column. Review the column assignments.</p> : null}
          {!missingRequired && !duplicateMapping && preview.length === 0 ? <p role="alert" className="mt-3 text-[13px] text-[#7c2523]">No employee rows found. Check the sheet and header row.</p> : null}

        </div>
      ) : null}
    </section>
  );
}
