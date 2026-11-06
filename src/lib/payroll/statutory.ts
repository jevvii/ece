/**
 * Philippine statutory dataset PH-2026.1.
 *
 * Every figure cites its authority. The dataset is NOT approved: calculation is
 * allowed, filing-authoritative output and approval are gated on acknowledgement.
 */

export const STATUTORY_VERSION = "PH-2026.1";
export const STATUTORY_APPROVED = false;

export const statutorySources = [
  {
    rule: "SSS contributions",
    authority: "SSS Circular No. 2024-006, effective January 2025 (still operative)",
    detail: "15% of MSC — 10% employer, 5% employee. MSC ₱5,000–₱35,000. EC ₱10/₱30.",
  },
  {
    rule: "PhilHealth",
    authority: "PhilHealth Advisory 2025-0002, re-adopted by PA 2026-0042",
    detail: "5.0% of monthly basic salary, floor ₱10,000, ceiling ₱100,000, split 50/50.",
  },
  {
    rule: "Pag-IBIG",
    authority: "HDMF Circular No. 460 (February 2024)",
    detail: "2% employee and 2% employer on fund salary capped at ₱10,000; 1% employee at or below ₱1,500.",
  },
  {
    rule: "Withholding tax",
    authority: "BIR RR 11-2018, Annex E, effective 1 January 2023 onwards",
    detail: "Semi-monthly table applied to each cutoff's taxable compensation.",
  },
  {
    rule: "13th month exclusion",
    authority: "RA 10963 §9, amending NIRC §32(B)(7)(e); RMC 50-2018",
    detail: "₱90,000 aggregate annual exclusion for 13th month and other benefits.",
  },
  {
    rule: "Premium pay",
    authority: "DOLE/BWC 2024 Handbook on Workers' Statutory Monetary Benefits",
    detail: "Rest day 130%, ordinary OT 125%, night differential +10%, holiday 200%, compounding.",
  },
] as const;

export const sss = {
  totalRate: 0.15,
  employeeRate: 0.05,
  employerRate: 0.1,
  mscFloor: 5000,
  mscCeiling: 35000,
  ecLow: 10,
  ecHigh: 30,
  ecThreshold: 14500,
  mpfThreshold: 20000,
} as const;

export const philhealth = {
  rate: 0.05,
  floor: 10000,
  ceiling: 100000,
  employeeShare: 0.5,
} as const;

export const pagibig = {
  employeeRate: 0.02,
  employeeRateLow: 0.01,
  employerRate: 0.02,
  lowThreshold: 1500,
  fundSalaryCap: 10000,
} as const;

export const taxBrackets = [
  { over: 0, base: 0, rate: 0 },
  { over: 10417, base: 0, rate: 0.15 },
  { over: 16667, base: 937.5, rate: 0.2 },
  { over: 33333, base: 4270.7, rate: 0.25 },
  { over: 83333, base: 16770.7, rate: 0.3 },
  { over: 333333, base: 91770.7, rate: 0.35 },
] as const;

export const thirteenthMonthCap = 90000;

export type PremiumKind = "overtime" | "restday" | "holiday" | "nightdiff";

export const premiumMatrix: Record<string, { rate: number; kind: PremiumKind; label: string }> = {
  ROT: { rate: 1.25, kind: "overtime", label: "Regular overtime" },
  ROT_ND: { rate: 1.375, kind: "overtime", label: "Overtime with night differential" },
  REG_OT: { rate: 1.25, kind: "overtime", label: "Regular overtime" },
  REG_OT_ND: { rate: 1.375, kind: "overtime", label: "Overtime with night differential" },
  EXT: { rate: 1.25, kind: "overtime", label: "Extension" },
  SAT: { rate: 1.3, kind: "restday", label: "Saturday / rest day" },
  SAT_ND: { rate: 1.43, kind: "restday", label: "Rest day with night differential" },
  SUN: { rate: 1.3, kind: "restday", label: "Sunday / rest day" },
  SUN_ND: { rate: 1.43, kind: "restday", label: "Rest day with night differential" },
  SUN_OT: { rate: 1.69, kind: "restday", label: "Rest day overtime" },
  SUN_OT_ND: { rate: 1.859, kind: "restday", label: "Rest day overtime with night differential" },
  SH: { rate: 1.3, kind: "holiday", label: "Special non-working day" },
  SH_OT: { rate: 1.69, kind: "holiday", label: "Special day overtime" },
  SH_ND: { rate: 1.43, kind: "holiday", label: "Special day with night differential" },
  LH: { rate: 2.0, kind: "holiday", label: "Regular holiday" },
  LH_OT: { rate: 2.6, kind: "holiday", label: "Regular holiday overtime" },
  ND: { rate: 0.1, kind: "nightdiff", label: "Night differential (premium only)" },
};

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

export function sssContribution(monthlyBasic: number) {
  const msc = Math.min(
    sss.mscCeiling,
    Math.max(sss.mscFloor, Math.round(monthlyBasic / 500) * 500),
  );
  return {
    msc,
    employee: round2(msc * sss.employeeRate),
    employer: round2(msc * sss.employerRate),
    ec: msc <= sss.ecThreshold ? sss.ecLow : sss.ecHigh,
  };
}

export function philhealthContribution(monthlyBasic: number) {
  const base = Math.min(philhealth.ceiling, Math.max(philhealth.floor, monthlyBasic));
  const premium = round2(base * philhealth.rate);
  const employee = round2(premium * philhealth.employeeShare);
  return { base, employee, employer: round2(premium - employee) };
}

export function pagibigContribution(monthlyBasic: number) {
  const fundSalary = Math.min(pagibig.fundSalaryCap, Math.max(0, monthlyBasic));
  const employeeRate = fundSalary <= pagibig.lowThreshold ? pagibig.employeeRateLow : pagibig.employeeRate;
  return {
    fundSalary,
    employee: round2(fundSalary * employeeRate),
    employer: round2(fundSalary * pagibig.employerRate),
  };
}

export function withholdingTax(taxableSemiMonthly: number) {
  if (taxableSemiMonthly <= 0) return 0;
  let bracket: (typeof taxBrackets)[number] = taxBrackets[0];
  for (const candidate of taxBrackets) {
    if (taxableSemiMonthly > candidate.over) bracket = candidate;
  }
  return round2(bracket.base + (taxableSemiMonthly - bracket.over) * bracket.rate);
}

/** Monthly liability split across the two cutoffs with the cent assigned to cutoff 2. */
export function splitAcrossCutoffs(monthlyAmount: number, cutoffNo: number) {
  const first = round2(monthlyAmount / 2);
  return cutoffNo === 1 ? first : round2(monthlyAmount - first);
}
