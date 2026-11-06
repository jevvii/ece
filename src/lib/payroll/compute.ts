import {
  pagibigContribution,
  philhealthContribution,
  premiumMatrix,
  round2,
  round4,
  splitAcrossCutoffs,
  sssContribution,
  withholdingTax,
} from "./statutory";

export type RunIssue = {
  employeeCode?: string;
  kind:
    | "no_attendance"
    | "no_schedule"
    | "partial_day"
    | "mwe_unknown"
    | "unknown_bucket"
    | "rest_day_hours"
    | "negative_net";
  message: string;
};

export type ComputeEmployee = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
  monthlyRate: number;
  monthlyAllowance: number;
  scheduleId: string | null;
  mweStatus: string;
};

export type ComputeInput = {
  cutoffNo: number;
  divisor: number;
  employees: ComputeEmployee[];
  schedules: Map<string, Set<number>>;
  attendance: Array<{ employeeId: string; workDate: string; hours: number }>;
  buckets: Array<{ employeeId: string; code: string; hours: number }>;
  adjustments?: Array<{ employeeId: string; kind: "earning" | "deduction"; amount: number }>;
};

export type ComputedLine = {
  employeeId: string;
  employeeCode: string;
  name: string;
  dailyRate: number;
  hourlyRate: number;
  daysPaid: number;
  basic: number;
  allowance: number;
  adjustmentEarning: number;
  overtime: number;
  nightDiff: number;
  holiday: number;
  premium: number;
  gross: number;
  sssEmployee: number;
  sssEmployer: number;
  philhealthEmployee: number;
  philhealthEmployer: number;
  pagibigEmployee: number;
  pagibigEmployer: number;
  tax: number;
  otherDeductions: number;
  netPay: number;
  thirteenthAccrual: number;
  breakdown: Array<{ code: string; label: string; hours: number; rate: number; amount: number }>;
};

export type ComputeResult = {
  lines: ComputedLine[];
  issues: RunIssue[];
  totals: Record<string, number>;
};

const weekdayOf = (isoDate: string) => {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

export function computePayroll(input: ComputeInput): ComputeResult {
  const { cutoffNo, divisor, employees, schedules, attendance, buckets } = input;
  const issues: RunIssue[] = [];

  const byEmployee = new Map<
    string,
    {
      days: Array<{ workDate: string; hours: number }>;
      buckets: Map<string, number>;
      adjustmentEarning: number;
      adjustmentDeduction: number;
    }
  >();

  for (const employee of employees) {
    byEmployee.set(employee.id, {
      days: [],
      buckets: new Map(),
      adjustmentEarning: 0,
      adjustmentDeduction: 0,
    });
  }
  for (const day of attendance) {
    byEmployee.get(day.employeeId)?.days.push({ workDate: day.workDate, hours: day.hours });
  }
  for (const bucket of buckets) {
    const entry = byEmployee.get(bucket.employeeId);
    if (!entry) continue;
    entry.buckets.set(bucket.code, round2((entry.buckets.get(bucket.code) ?? 0) + bucket.hours));
  }
  for (const adjustment of input.adjustments ?? []) {
    const entry = byEmployee.get(adjustment.employeeId);
    if (!entry) continue;
    if (adjustment.kind === "earning") entry.adjustmentEarning += adjustment.amount;
    else entry.adjustmentDeduction += adjustment.amount;
  }

  const lines: ComputedLine[] = [];

  for (const employee of employees) {
    const entry = byEmployee.get(employee.id);
    if (!entry) continue;

    const dailyRate = round4(employee.monthlyRate / divisor);
    const hourlyRate = round4(dailyRate / 8);
    const schedule = employee.scheduleId ? schedules.get(employee.scheduleId) : undefined;

    if (!schedule) {
      issues.push({
        employeeCode: employee.employeeCode,
        kind: "no_schedule",
        message: "No work schedule assigned; every imported day was treated as a workday.",
      });
    }

    let daysPaid = 0;
    let restDayHours = 0;

    for (const day of entry.days) {
      const scheduled = schedule ? schedule.has(weekdayOf(day.workDate)) : true;
      if (!scheduled) {
        restDayHours += day.hours;
        continue;
      }
      if (day.hours <= 0) continue;
      if (day.hours < 4) {
        daysPaid += 0.5;
        issues.push({
          employeeCode: employee.employeeCode,
          kind: "partial_day",
          message: `${day.workDate}: ${day.hours} h counted as a half day.`,
        });
      } else {
        daysPaid += 1;
      }
    }

    const basic = round2(dailyRate * daysPaid);
    const allowance = splitAcrossCutoffs(employee.monthlyAllowance, cutoffNo);

    let overtime = 0;
    let nightDiff = 0;
    let holiday = 0;
    let premium = 0;
    const breakdown: ComputedLine["breakdown"] = [];

    for (const [code, hours] of entry.buckets) {
      const rule = premiumMatrix[code];
      if (!rule) {
        issues.push({
          employeeCode: employee.employeeCode,
          kind: "unknown_bucket",
          message: `Bucket ${code} has no approved multiplier and was skipped.`,
        });
        continue;
      }

      const amount = round2(hours * hourlyRate * rule.rate);
      if (rule.kind === "nightdiff") nightDiff += amount;
      else if (rule.kind === "overtime") overtime += amount;
      else if (rule.kind === "holiday") holiday += amount;
      else premium += amount;

      breakdown.push({ code, label: rule.label, hours, rate: rule.rate, amount });
    }

    if (restDayHours > 0 && entry.buckets.size === 0) {
      issues.push({
        employeeCode: employee.employeeCode,
        kind: "rest_day_hours",
        message: `${restDayHours.toFixed(2)} h fall on non-scheduled days with no premium bucket; they are unpaid.`,
      });
    }

    const bucketHours = [...entry.buckets.values()].reduce((sum, hours) => sum + hours, 0);
    if (daysPaid === 0 && bucketHours === 0 && entry.adjustmentEarning === 0 && entry.adjustmentDeduction === 0) {
      issues.push({
        employeeCode: employee.employeeCode,
        kind: "no_attendance",
        message: "No paid attendance; employee omitted from the register.",
      });
      continue;
    }

    if (employee.mweStatus === "unknown") {
      issues.push({
        employeeCode: employee.employeeCode,
        kind: "mwe_unknown",
        message: "Minimum-wage status is not established; taxed as a regular employee pending review.",
      });
    }

    const adjustmentEarning = round2(entry.adjustmentEarning);
    const gross = round2(basic + allowance + adjustmentEarning + overtime + nightDiff + holiday + premium);

    const sssMonthly = sssContribution(employee.monthlyRate);
    const phMonthly = philhealthContribution(employee.monthlyRate);
    const piMonthly = pagibigContribution(employee.monthlyRate);

    const sssEmployee = splitAcrossCutoffs(sssMonthly.employee, cutoffNo);
    const sssEmployer = splitAcrossCutoffs(sssMonthly.employer + sssMonthly.ec, cutoffNo);
    const philhealthEmployee = splitAcrossCutoffs(phMonthly.employee, cutoffNo);
    const philhealthEmployer = splitAcrossCutoffs(phMonthly.employer, cutoffNo);
    const pagibigEmployee = splitAcrossCutoffs(piMonthly.employee, cutoffNo);
    const pagibigEmployer = splitAcrossCutoffs(piMonthly.employer, cutoffNo);

    const taxable =
      employee.mweStatus === "mwe"
        ? 0
        : Math.max(0, round2(gross - sssEmployee - philhealthEmployee - pagibigEmployee));

    const tax = withholdingTax(taxable);
    const otherDeductions = round2(entry.adjustmentDeduction);
    const netPay = round2(gross - sssEmployee - philhealthEmployee - pagibigEmployee - tax - otherDeductions);
    if (netPay < 0) {
      issues.push({
        employeeCode: employee.employeeCode,
        kind: "negative_net",
        message: "Net pay is negative; contributions exceed earnings. Resolve before approval.",
      });
    }
    const thirteenthAccrual = round2(basic / 12);

    lines.push({
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      name: `${employee.lastName}, ${employee.firstName}`,
      dailyRate,
      hourlyRate,
      daysPaid,
      basic,
      allowance,
      adjustmentEarning,
      overtime: round2(overtime),
      nightDiff: round2(nightDiff),
      holiday: round2(holiday),
      premium: round2(premium),
      gross,
      sssEmployee,
      sssEmployer,
      philhealthEmployee,
      philhealthEmployer,
      pagibigEmployee,
      pagibigEmployer,
      tax,
      otherDeductions,
      netPay,
      thirteenthAccrual,
      breakdown,
    });
  }

  const totals = {
    employees: lines.length,
    gross: round2(lines.reduce((sum, line) => sum + line.gross, 0)),
    basic: round2(lines.reduce((sum, line) => sum + line.basic, 0)),
    allowance: round2(lines.reduce((sum, line) => sum + line.allowance, 0)),
    adjustmentEarning: round2(lines.reduce((sum, line) => sum + line.adjustmentEarning, 0)),
    otherDeductions: round2(lines.reduce((sum, line) => sum + line.otherDeductions, 0)),
    overtime: round2(lines.reduce((sum, line) => sum + line.overtime, 0)),
    nightDiff: round2(lines.reduce((sum, line) => sum + line.nightDiff, 0)),
    holiday: round2(lines.reduce((sum, line) => sum + line.holiday, 0)),
    premium: round2(lines.reduce((sum, line) => sum + line.premium, 0)),
    sssEmployee: round2(lines.reduce((sum, line) => sum + line.sssEmployee, 0)),
    sssEmployer: round2(lines.reduce((sum, line) => sum + line.sssEmployer, 0)),
    philhealthEmployee: round2(lines.reduce((sum, line) => sum + line.philhealthEmployee, 0)),
    philhealthEmployer: round2(lines.reduce((sum, line) => sum + line.philhealthEmployer, 0)),
    pagibigEmployee: round2(lines.reduce((sum, line) => sum + line.pagibigEmployee, 0)),
    pagibigEmployer: round2(lines.reduce((sum, line) => sum + line.pagibigEmployer, 0)),
    tax: round2(lines.reduce((sum, line) => sum + line.tax, 0)),
    netPay: round2(lines.reduce((sum, line) => sum + line.netPay, 0)),
    thirteenthAccrual: round2(lines.reduce((sum, line) => sum + line.thirteenthAccrual, 0)),
  };

  return { lines, issues, totals };
}
