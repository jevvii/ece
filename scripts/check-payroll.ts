import assert from "node:assert/strict";
import {
  pagibigContribution,
  philhealthContribution,
  splitAcrossCutoffs,
  sssContribution,
  withholdingTax,
} from "../src/lib/payroll/statutory";
import { computePayroll } from "../src/lib/payroll/compute";

assert.deepEqual(sssContribution(30000), { msc: 30000, employee: 1500, employer: 3000, ec: 30 });
assert.deepEqual(sssContribution(5000), { msc: 5000, employee: 250, employer: 500, ec: 10 });
assert.deepEqual(sssContribution(40000), { msc: 35000, employee: 1750, employer: 3500, ec: 30 });

assert.deepEqual(philhealthContribution(30000), { base: 30000, employee: 750, employer: 750 });
assert.deepEqual(philhealthContribution(5000), { base: 10000, employee: 250, employer: 250 });
assert.deepEqual(philhealthContribution(150000), { base: 100000, employee: 2500, employer: 2500 });

assert.deepEqual(pagibigContribution(30000), { fundSalary: 10000, employee: 200, employer: 200 });
assert.deepEqual(pagibigContribution(1200), { fundSalary: 1200, employee: 12, employer: 24 });

assert.equal(withholdingTax(10417), 0);
assert.equal(withholdingTax(11592.31), 176.3);
assert.equal(withholdingTax(20000), 1604.1);

assert.equal(splitAcrossCutoffs(1500, 1), 750);
assert.equal(splitAcrossCutoffs(1500, 2), 750);
assert.equal(splitAcrossCutoffs(1234.57, 1), 617.29);
assert.equal(splitAcrossCutoffs(1234.57, 2), 617.28);

const result = computePayroll({
  cutoffNo: 1,
  divisor: 26,
  employees: [
    {
      id: "e1",
      employeeCode: "BAY-0001",
      lastName: "Santos",
      firstName: "Maria",
      monthlyRate: 30000,
      monthlyAllowance: 1000,
      scheduleId: "s1",
      mweStatus: "not_mwe",
    },
  ],
  schedules: new Map([["s1", new Set([1, 2, 3, 4, 5])]]),
  attendance: [
    "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30",
    "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
    "2026-11-09",
  ].map((workDate) => ({ employeeId: "e1", workDate, hours: 8 })),
  buckets: [],
});

assert.equal(result.lines.length, 1);
const line = result.lines[0];
assert.ok(line);
assert.equal(line.daysPaid, 11);
assert.equal(line.basic, 12692.31);
assert.equal(line.allowance, 500);
assert.equal(line.gross, 13192.31);
assert.equal(line.sssEmployee, 750);
assert.equal(line.sssEmployer, 1515);
assert.equal(line.philhealthEmployee, 375);
assert.equal(line.pagibigEmployee, 100);
assert.equal(line.tax, 232.55);
assert.equal(line.netPay, 11734.76);
assert.equal(line.thirteenthAccrual, 1057.69);
assert.equal(result.totals.netPay, 11734.76);

const cutoff2 = computePayroll({
  cutoffNo: 2,
  divisor: 26,
  employees: [
    {
      id: "e1",
      employeeCode: "BAY-0001",
      lastName: "Santos",
      firstName: "Maria",
      monthlyRate: 30000,
      monthlyAllowance: 1000,
      scheduleId: null,
      mweStatus: "not_mwe",
    },
  ],
  schedules: new Map(),
  attendance: [{ employeeId: "e1", workDate: "2026-11-16", hours: 8 }],
  buckets: [{ employeeId: "e1", code: "ROT", hours: 2 }],
});

const second = cutoff2.lines[0];
assert.ok(second);
assert.equal(second.daysPaid, 1);
assert.equal(second.overtime, 360.58); // 2h × 1153.8462/8 × 1.25
assert.equal(second.allowance, 500);
assert.ok(cutoff2.issues.some((issue) => issue.kind === "no_schedule"));

console.log("payroll engine checks passed");
