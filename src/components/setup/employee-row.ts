export type EmployeeDraft = {
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

export type DateOrder = "mdy" | "dmy" | "iso";

export const dateOrderLabel: Record<DateOrder, string> = {
  mdy: "Month/Day/Year",
  dmy: "Day/Month/Year",
  iso: "Year-Month-Day",
};

export function blankDraft(): EmployeeDraft {
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

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Excel stores dates as days since 1899-12-30. */
function fromSerial(value: number) {
  const millis = Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000;
  const date = new Date(millis);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function normaliseDate(value: string, order: DateOrder): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slash = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = slash[3] ?? "";
    const month = order === "dmy" ? second : first;
    const day = order === "dmy" ? first : second;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  if (/^\d{5}$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial >= 20_000 && serial <= 80_000) return fromSerial(serial);
  }

  return "";
}

/** Reads the ambiguous order from the data: a value above 12 disambiguates it. */
export function inferDateOrder(values: string[]): DateOrder {
  let mdyEvidence = false;
  let dmyEvidence = false;

  for (const value of values) {
    const match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12) dmyEvidence = true;
    if (second > 12) mdyEvidence = true;
  }

  if (dmyEvidence && !mdyEvidence) return "dmy";
  return "mdy";
}

export function normaliseRate(value: string) {
  return value.replace(/[₱$,\s]/g, "");
}

export type EmployeeIssueField = "employeeCode" | "employeeName" | "hireDate" | "monthlyRate";
export type EmployeeIssue = { field: EmployeeIssueField; message: string };

export function rowIssues(row: EmployeeDraft): EmployeeIssue[] {
  const issues: EmployeeIssue[] = [];
  if (!row.employeeCode.trim()) issues.push({ field: "employeeCode", message: "Code missing" });
  if (!row.employeeName.includes(",")) {
    issues.push({ field: "employeeName", message: "Name must be \"Last, First\"" });
  }
  if (!row.hireDate) issues.push({ field: "hireDate", message: "Hire date missing" });
  if (!row.monthlyRate || Number.isNaN(Number(row.monthlyRate))) {
    issues.push({ field: "monthlyRate", message: "Rate missing" });
  }
  return issues;
}

export function rowProblem(row: EmployeeDraft) {
  return rowIssues(row)[0]?.message ?? null;
}

const PASTE_HEADERS: Record<string, keyof EmployeeDraft> = {
  employeeid: "employeeCode",
  employeeidnumber: "employeeCode",
  employeecode: "employeeCode",
  code: "employeeCode",
  id: "employeeCode",
  employeename: "employeeName",
  name: "employeeName",
  lastname: "employeeName",
  surname: "employeeName",
  firstname: "employeeName",
  givenname: "employeeName",
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

function normaliseHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

/** Tab- or comma-separated paste, with a header row. */
export function parsePasteRows(text: string, order: DateOrder = "mdy") {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { rows: [] as EmployeeDraft[], error: "Paste a header row and at least one employee row." };
  }

  const headerLine = lines[0] ?? "";
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const headers = headerLine.split(delimiter).map((header) => PASTE_HEADERS[normaliseHeader(header)]);

  if (!headers.includes("employeeCode") || !headers.includes("employeeName")) {
    return {
      rows: [] as EmployeeDraft[],
      error: "The header needs an Employee ID and an Employee Name column.",
    };
  }

  const rows = lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const draft = blankDraft();
    headers.forEach((key, index) => {
      if (!key) return;
      const value = (cells[index] ?? "").trim();
      if (key === "birthday" || key === "hireDate" || key === "separationDate") {
        draft[key] = normaliseDate(value, order);
      } else if (key === "monthlyRate") {
        draft.monthlyRate = normaliseRate(value);
      } else {
        draft[key] = value;
      }
    });
    return draft;
  });

  return { rows, error: null as string | null };
}
