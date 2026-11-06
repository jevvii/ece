export type CalendarPattern = "26_10" | "01_15" | "custom";

export type CalendarSpec = {
  pattern: CalendarPattern;
  cutoff1Start: number;
  cutoff1End: number;
  cutoff2Start: number;
  /** null = end of month */
  cutoff2End: number | null;
  paydayRule: "same_day" | "earlier_business_day" | "later_business_day";
  paydayOffsetDays: number;
};

export const calendarPresets: Record<Exclude<CalendarPattern, "custom">, CalendarSpec> = {
  "26_10": {
    pattern: "26_10",
    cutoff1Start: 26,
    cutoff1End: 10,
    cutoff2Start: 11,
    cutoff2End: 25,
    paydayRule: "same_day",
    paydayOffsetDays: 0,
  },
  "01_15": {
    pattern: "01_15",
    cutoff1Start: 1,
    cutoff1End: 15,
    cutoff2Start: 16,
    cutoff2End: null,
    paydayRule: "same_day",
    paydayOffsetDays: 0,
  },
};

export const iso = (date: Date) => date.toISOString().slice(0, 10);

export const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, daysInMonth(year, month)));

function shiftToBusinessDay(date: Date, rule: CalendarSpec["paydayRule"], offset: number) {
  if (rule === "same_day" || offset === 0) return date;
  const shifted = addDays(date, rule === "earlier_business_day" ? -offset : offset);
  const weekday = shifted.getUTCDay();
  if (weekday === 6) return addDays(shifted, rule === "earlier_business_day" ? -1 : 2);
  if (weekday === 0) return addDays(shifted, rule === "earlier_business_day" ? -2 : 1);
  return shifted;
}

export type GeneratedPeriod = {
  cutoffNo: number;
  coverageStart: string;
  coverageEnd: string;
  payDate: string;
  cycleLabel: string;
};

export function buildPeriods(spec: CalendarSpec, year: number): GeneratedPeriod[] {
  const rows: GeneratedPeriod[] = [];

  for (let month = 0; month < 12; month += 1) {
    const label = new Intl.DateTimeFormat("en-PH", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month, 1)));

    const make = (cutoffNo: number, start: Date, end: Date, pay: Date): GeneratedPeriod => ({
      cutoffNo,
      coverageStart: iso(start),
      coverageEnd: iso(end),
      payDate: iso(pay),
      cycleLabel: label,
    });

    const crossesMonth = spec.cutoff1Start > spec.cutoff1End;
    const c1Start = new Date(Date.UTC(year, crossesMonth ? month - 1 : month, spec.cutoff1Start));
    const c1End = new Date(Date.UTC(year, month, spec.cutoff1End));
    const c1Payday =
      spec.cutoff1End === 15
        ? new Date(Date.UTC(year, month, 20))
        : new Date(Date.UTC(year, month, 15));

    const c2Start = new Date(Date.UTC(year, month, spec.cutoff2Start));
    const c2End =
      spec.cutoff2End === null
        ? lastDayOfMonth(year, month)
        : new Date(Date.UTC(year, month, spec.cutoff2End));
    const c2Payday =
      spec.cutoff2End === null
        ? new Date(Date.UTC(year, month + 1, 5))
        : lastDayOfMonth(year, month);

    rows.push(
      make(1, c1Start, c1End, shiftToBusinessDay(c1Payday, spec.paydayRule, spec.paydayOffsetDays)),
    );
    rows.push(
      make(2, c2Start, c2End, shiftToBusinessDay(c2Payday, spec.paydayRule, spec.paydayOffsetDays)),
    );
  }

  return rows;
}

export function validateSpec(spec: CalendarSpec): string | null {
  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= 31;

  if (!inRange(spec.cutoff1Start) || !inRange(spec.cutoff1End) || !inRange(spec.cutoff2Start)) {
    return "Cutoff days must be whole numbers from 1 to 31.";
  }
  if (spec.cutoff2End !== null && !inRange(spec.cutoff2End)) {
    return "The second cutoff's end day must be 1–31, or empty for end of month.";
  }

  if (spec.pattern === "26_10") {
    const expected =
      spec.cutoff1Start === 26 && spec.cutoff1End === 10 && spec.cutoff2Start === 11 && spec.cutoff2End === 25;
    if (!expected) return "The 26–10 pattern uses 26→10, then 11→25.";
  }

  if (spec.pattern === "01_15") {
    const expected =
      spec.cutoff1Start === 1 && spec.cutoff1End === 15 && spec.cutoff2Start === 16 && spec.cutoff2End === null;
    if (!expected) return "The 1–15 pattern uses 1→15, then 16→end of month.";
  }

  if (spec.pattern === "custom") {
    if (spec.cutoff1Start === spec.cutoff1End) return "A cutoff cannot start and end on the same day.";
    if (spec.cutoff2End !== null && spec.cutoff2Start > spec.cutoff2End) {
      return "The second cutoff would run backwards. Use end of month for a cutoff that closes the month.";
    }
  }

  return null;
}
