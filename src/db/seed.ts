/**
 * Demo tenant seed. Synthetic people, synthetic money.
 * Refuses to run against a database that already has companies unless --reset.
 */
import { sql } from "./client";
import { db } from "./client";
import {
  auditEvents,
  employees,
  firms,
  memberships,
  payrollCalendars,
  payrollPeriods,
  ranks,
  tenants,
  users,
  workScheduleDays,
  workSchedules,
} from "./schema";
import { hashPassword } from "../lib/password";

const DEMO_PASSWORD = "payroll123";

type Pattern = "26_10" | "01_15";

type CalendarSpec = {
  name: string;
  pattern: Pattern;
  cutoff1Start: number;
  cutoff1End: number;
  cutoff2Start: number;
  cutoff2End: number | null;
};

const patterns: Record<Pattern, CalendarSpec> = {
  "26_10": {
    name: "Semi-monthly · 26–10 / 11–25",
    pattern: "26_10",
    cutoff1Start: 26,
    cutoff1End: 10,
    cutoff2Start: 11,
    cutoff2End: 25,
  },
  "01_15": {
    name: "Semi-monthly · 1–15 / 16–end of month",
    pattern: "01_15",
    cutoff1Start: 1,
    cutoff1End: 15,
    cutoff2Start: 16,
    cutoff2End: null,
  },
};

const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, daysInMonth(year, month)));
}

/** Business-day shift used by the payday rule. */
function shiftToBusinessDay(date: Date, rule: string, offset: number) {
  const shifted = addDays(date, rule === "earlier_business_day" ? -offset : offset);
  const day = shifted.getUTCDay();
  if (day === 6) return addDays(shifted, rule === "earlier_business_day" ? -1 : 2);
  if (day === 0) return addDays(shifted, rule === "earlier_business_day" ? -2 : 1);
  return shifted;
}

function buildPeriods(spec: CalendarSpec, year: number) {
  const rows: Array<{
    cutoffNo: number;
    coverageStart: string;
    coverageEnd: string;
    payDate: string;
    cycleLabel: string;
  }> = [];

  for (let month = 0; month < 12; month += 1) {
    const label = new Intl.DateTimeFormat("en-PH", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month, 1)));

    const period = (cutoffNo: number, start: Date, end: Date, pay: Date) => ({
      cutoffNo,
      coverageStart: iso(start),
      coverageEnd: iso(end),
      payDate: iso(pay),
      cycleLabel: label,
      status: "open" as const,
    });

    // Cutoff 1
    const c1StartMonth = spec.cutoff1Start > spec.cutoff1End ? month - 1 : month;
    const c1Start = new Date(Date.UTC(year, c1StartMonth, spec.cutoff1Start));
    const c1End = new Date(Date.UTC(year, month, spec.cutoff1End));
    const c1Pay =
      spec.cutoff1End === 15
        ? shiftToBusinessDay(new Date(Date.UTC(year, month, 20)), "same_day", 0)
        : shiftToBusinessDay(new Date(Date.UTC(year, month, 15)), "same_day", 0);

    // Cutoff 2
    const c2Start = new Date(Date.UTC(year, month, spec.cutoff2Start));
    const c2End =
      spec.cutoff2End === null ? lastDayOfMonth(year, month) : new Date(Date.UTC(year, month, spec.cutoff2End));
    const c2Pay =
      spec.cutoff2End === null
        ? shiftToBusinessDay(new Date(Date.UTC(year, month + 1, 5)), "same_day", 0)
        : shiftToBusinessDay(lastDayOfMonth(year, month), "same_day", 0);

    rows.push(period(1, c1Start, c1End, c1Pay));
    rows.push(period(2, c2Start, c2End, c2Pay));
  }

  return rows;
}

async function insertSchedule(
  tenantId: string,
  name: string,
  isDefault: boolean,
  workdays: number[],
  startTime: string,
  endTime: string,
  breakMinutes: number,
) {
  const [schedule] = await db
    .insert(workSchedules)
    .values({ tenantId, name, isDefault, timezone: "Asia/Manila" })
    .returning();

  if (!schedule) throw new Error("schedule insert failed");

  await db.insert(workScheduleDays).values(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      scheduleId: schedule.id,
      weekday,
      isWorkday: workdays.includes(weekday),
      startTime: workdays.includes(weekday) ? startTime : null,
      endTime: workdays.includes(weekday) ? endTime : null,
      breakMinutes,
    })),
  );

  return schedule;
}

async function main() {
  const reset = process.argv.includes("--reset");
  const countRows = await sql<{ count: number }[]>`select count(*)::int as count from tenants`;
  const count = countRows[0]?.count ?? 0;

  if (count > 0 && !reset) {
    console.error(
      `Refusing to seed: ${count} tenant(s) already exist. Re-run with --reset to rebuild demo data.`,
    );
    process.exit(1);
  }

  await sql`truncate table audit_events, employees, ranks, work_schedule_days, work_schedules,
            payroll_periods, payroll_calendars, sessions, memberships, tenants, firms, users
            restart identity cascade`;

  const passwordHash = hashPassword(DEMO_PASSWORD);

  const [firm] = await db.insert(firms).values({ name: "Tala & Co. Accounting" }).returning();
  if (!firm) throw new Error("firm insert failed");

  const [maria, jose, ana] = await db
    .insert(users)
    .values([
      { email: "maria@tala.ph", name: "Maria Tala", passwordHash },
      { email: "jose@bayanihan.ph", name: "Jose Bayanihan", passwordHash },
      { email: "ana@tala.ph", name: "Ana Tala", passwordHash },
    ])
    .returning();

  if (!maria || !jose || !ana) throw new Error("user insert failed");

  const [bayanihan, ilaya] = await db
    .insert(tenants)
    .values([
      {
        firmId: firm.id,
        legalName: "Bayanihan Trading Corp.",
        tradeName: "Bayanihan Trading",
        tin: "004-123-456-000",
        rdoCode: "045",
        addressLine: "12F One Corporate Centre, Ortigas Center, Pasig City",
        regionCode: "NCR",
        employerType: "private",
        salaryDivisor: 26,
        onboardingStep: 3,
      },
      {
        firmId: firm.id,
        legalName: "Ilaya Foods Inc.",
        tradeName: "Ilaya Foods",
        tin: "008-765-432-000",
        rdoCode: "039",
        addressLine: "Km. 42 National Highway, Calamba, Laguna",
        regionCode: "IV-A",
        employerType: "private",
        salaryDivisor: 22,
        onboardingStep: 2,
      },
    ])
    .returning();

  if (!bayanihan || !ilaya) throw new Error("tenant insert failed");

  await db.insert(memberships).values([
    { tenantId: bayanihan.id, userId: maria.id, role: "company_admin", seatNo: 1 },
    { tenantId: bayanihan.id, userId: jose.id, role: "payroll_officer", seatNo: 2 },
    { tenantId: bayanihan.id, userId: ana.id, role: "approver", seatNo: 3, canViewPayroll: true },
    { tenantId: ilaya.id, userId: maria.id, role: "payroll_officer", seatNo: 1 },
    { tenantId: ilaya.id, userId: ana.id, role: "approver", seatNo: 2 },
  ]);

  for (const [tenant, spec] of [
    [bayanihan, patterns["26_10"]],
    [ilaya, patterns["01_15"]],
  ] as const) {
    const [calendar] = await db
      .insert(payrollCalendars)
      .values({
        tenantId: tenant.id,
        name: spec.name,
        patternCode: spec.pattern,
        cutoff1StartDay: spec.cutoff1Start,
        cutoff1EndDay: spec.cutoff1End,
        cutoff2StartDay: spec.cutoff2Start,
        cutoff2EndDay: spec.cutoff2End,
        paydayRule: "same_day",
        paydayOffsetDays: 0,
        effectiveFrom: "2026-01-01",
      })
      .returning();

    if (!calendar) throw new Error("calendar insert failed");
    await db.insert(payrollPeriods).values(buildPeriods(spec, 2026).map((row) => ({ ...row, calendarId: calendar.id })));
  }

  const bayanihanFriday = await insertSchedule(
    bayanihan.id,
    "Mon–Fri · 8:00 to 17:00",
    true,
    [1, 2, 3, 4, 5],
    "08:00",
    "17:00",
    60,
  );
  await insertSchedule(
    bayanihan.id,
    "Mon–Sat · 8:00 to 17:00",
    false,
    [1, 2, 3, 4, 5, 6],
    "08:00",
    "17:00",
    60,
  );
  const ilayaSunThursday = await insertSchedule(
    ilaya.id,
    "Sun–Thu · 7:30 to 16:30",
    true,
    [7, 1, 2, 3, 4],
    "07:30",
    "16:30",
    60,
  );

  const [bayanihanRanks, ilayaRanks] = await Promise.all([
    db
      .insert(ranks)
      .values([
        { tenantId: bayanihan.id, name: "Rank & File", level: 1 },
        { tenantId: bayanihan.id, name: "Supervisor", level: 2 },
        { tenantId: bayanihan.id, name: "Manager", level: 3 },
      ])
      .returning(),
    db
      .insert(ranks)
      .values([
        { tenantId: ilaya.id, name: "Rank & File", level: 1 },
        { tenantId: ilaya.id, name: "Supervisor", level: 2 },
      ])
      .returning(),
  ]);

  const rankId = (list: typeof bayanihanRanks, level: number) =>
    list.find((rank) => rank.level === level)?.id ?? null;

  const bayanihanPeople = [
    ["BAY-0001", "Santos", "Maria Clara", 32000, 2],
    ["BAY-0002", "Reyes", "Juan Miguel", 26000, 1],
    ["BAY-0003", "Cruz", "Ana Liza", 18500, 1],
    ["BAY-0004", "Villanueva", "Paolo", 45000, 3],
    ["BAY-0005", "Mendoza", "Grace", 21500, 1],
    ["BAY-0006", "Bautista", "Ramon", 28000, 2],
    ["BAY-0007", "Ocampo", "Liza", 19500, 1],
    ["BAY-0008", "Garcia", "Nico", 17500, 1],
  ] as const;

  const ilayaPeople = [
    ["ILA-0001", "Aquino", "Rosa", 24000, 1],
    ["ILA-0002", "Domingo", "Carlo", 30000, 2],
    ["ILA-0003", "Salazar", "Bea", 17000, 1],
    ["ILA-0004", "Pascual", "Ernesto", 38000, 2],
    ["ILA-0005", "Navarro", "Tess", 16500, 1],
  ] as const;

  await db.insert(employees).values([
    ...bayanihanPeople.map(([code, last, first, rate, level]) => ({
      tenantId: bayanihan.id,
      employeeCode: code,
      tin: `${code.replace(/\D/g, "").padStart(9, "0").slice(0, 3)}-${code.replace(/\D/g, "").padStart(9, "0").slice(3, 6)}-${code.replace(/\D/g, "").padStart(9, "0").slice(6, 9)}-000`,
      lastName: last,
      firstName: first,
      hireDate: "2024-03-04",
      rankId: rankId(bayanihanRanks, level),
      scheduleId:
        level === 1 ? bayanihanFriday.id : bayanihanFriday.id,
      monthlyRate: rate.toFixed(2),
      monthlyAllowance: "1000.00",
      mweStatus: "not_mwe",
      dailyRate: (rate / bayanihan.salaryDivisor).toFixed(2),
      regionCode: "NCR",
    })),
    ...ilayaPeople.map(([code, last, first, rate, level]) => ({
      tenantId: ilaya.id,
      employeeCode: code,
      tin: `${code.replace(/\D/g, "").padStart(9, "0").slice(0, 3)}-${code.replace(/\D/g, "").padStart(9, "0").slice(3, 6)}-${code.replace(/\D/g, "").padStart(9, "0").slice(6, 9)}-000`,
      lastName: last,
      firstName: first,
      hireDate: "2025-01-06",
      rankId: rankId(ilayaRanks, level),
      scheduleId: ilayaSunThursday.id,
      monthlyRate: rate.toFixed(2),
      monthlyAllowance: "800.00",
      mweStatus: "not_mwe",
      dailyRate: (rate / ilaya.salaryDivisor).toFixed(2),
      regionCode: "IV-A",
    })),
  ]);

  await db.insert(auditEvents).values({
    tenantId: bayanihan.id,
    actorUserId: maria.id,
    entity: "workspace",
    action: "workspace.seeded",
    detail: { demo: true, version: 1 },
  });

  console.log(`Seeded ${DEMO_PASSWORD} for maria@tala.ph, jose@bayanihan.ph, ana@tala.ph`);
  console.log(`Two companies, ${bayanihanPeople.length + ilayaPeople.length} employees, 2026 cutoffs generated.`);
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
