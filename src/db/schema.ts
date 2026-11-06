import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Identity and tenancy                                               */
/* ------------------------------------------------------------------ */

export const firms = pgTable("firms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One tenant is one legal company. A firm (bureau) may hold several. */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: uuid("firm_id").references(() => firms.id),
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name"),
  tin: text("tin"),
  rdoCode: text("rdo_code"),
  addressLine: text("address_line"),
  regionCode: text("region_code"),
  employerType: text("employer_type").notNull().default("private"),
  salaryDivisor: integer("salary_divisor").notNull().default(26),
  currency: text("currency").notNull().default("PHP"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  setupVersion: integer("setup_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("payroll_officer"),
    seatNo: integer("seat_no").notNull().default(1),
    canViewPayroll: boolean("can_view_payroll").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_tenant_user_idx").on(table.tenantId, table.userId),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

/* ------------------------------------------------------------------ */
/* Payroll setup                                                      */
/* ------------------------------------------------------------------ */

export const payrollCalendars = pgTable("payroll_calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** 26_10 | 11_25 | 01_15 | 16_EOM | custom */
  patternCode: text("pattern_code").notNull(),
  cutoff1StartDay: integer("cutoff_1_start_day").notNull(),
  cutoff1EndDay: integer("cutoff_1_end_day").notNull(),
  cutoff2StartDay: integer("cutoff_2_start_day").notNull(),
  /** null means "end of month". */
  cutoff2EndDay: integer("cutoff_2_end_day"),
  /** same_day | earlier_business_day | later_business_day */
  paydayRule: text("payday_rule").notNull().default("same_day"),
  paydayOffsetDays: integer("payday_offset_days").notNull().default(0),
  effectiveFrom: date("effective_from").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => payrollCalendars.id, { onDelete: "cascade" }),
    cutoffNo: smallint("cutoff_no").notNull(),
    coverageStart: date("coverage_start").notNull(),
    coverageEnd: date("coverage_end").notNull(),
    payDate: date("pay_date").notNull(),
    cycleLabel: text("cycle_label").notNull(),
    status: text("status").notNull().default("open"),
  },
  (table) => [index("periods_calendar_idx").on(table.calendarId)],
);

export const workSchedules = pgTable("work_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  timezone: text("timezone").notNull().default("Asia/Manila"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** weekday: 1 = Monday ... 7 = Sunday */
export const workScheduleDays = pgTable(
  "work_schedule_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => workSchedules.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    isWorkday: boolean("is_workday").notNull().default(true),
    startTime: time("start_time"),
    endTime: time("end_time"),
    breakMinutes: integer("break_minutes").notNull().default(60),
  },
  (table) => [uniqueIndex("schedule_day_idx").on(table.scheduleId, table.weekday)],
);

export const ranks = pgTable("ranks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  level: integer("level").notNull().default(1),
});

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeCode: text("employee_code").notNull(),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    tin: text("tin"),
    hireDate: date("hire_date").notNull(),
    separationDate: date("separation_date"),
    status: text("status").notNull().default("active"),
    rankId: uuid("rank_id").references(() => ranks.id),
    scheduleId: uuid("schedule_id").references(() => workSchedules.id),
    monthlyRate: numeric("monthly_rate", { precision: 12, scale: 2 }).notNull().default("0"),
    monthlyAllowance: numeric("monthly_allowance", { precision: 12, scale: 2 }).notNull().default("0"),
    /** unknown | mwe | not_mwe — never derived silently from an unverified wage order. */
    mweStatus: text("mwe_status").notNull().default("unknown"),
    dailyRate: numeric("daily_rate", { precision: 12, scale: 2 }),
    regionCode: text("region_code"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("employees_tenant_code_idx").on(table.tenantId, table.employeeCode),
    index("employees_tenant_idx").on(table.tenantId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_tenant_idx").on(table.tenantId)],
);

/* ------------------------------------------------------------------ */
/* Time report import                                                 */
/* ------------------------------------------------------------------ */

/**
 * A saved, versioned column mapping. Importing again with the same profile
 * runs deterministically — the parser never guesses once a profile exists.
 */
export const importProfiles = pgTable(
  "import_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    mapping: jsonb("mapping").notNull(),
    sourceSignature: text("source_signature"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("import_profiles_tenant_idx").on(table.tenantId)],
);

export const importRuns = pgTable(
  "import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => importProfiles.id, { onDelete: "set null" }),
    periodId: uuid("period_id").references(() => payrollPeriods.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    fileKind: text("file_kind").notNull(),
    fileSize: integer("file_size").notNull().default(0),
    storageKey: text("storage_key"),
    /** mapping | imported | failed */
    status: text("status").notNull().default("mapping"),
    mapping: jsonb("mapping").notNull(),
    issues: jsonb("issues"),
    rowCount: integer("row_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("import_runs_tenant_idx").on(table.tenantId)],
);

/** Reviewed bindings from a client's external employee code to our employee record. */
export const employeeExternalIds = pgTable(
  "employee_external_ids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("employee_external_code_idx").on(table.tenantId, table.code)],
);

export const attendanceDays = pgTable(
  "attendance_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull().default("0"),
    sourceValue: text("source_value"),
  },
  (table) => [
    uniqueIndex("attendance_day_unique_idx").on(table.runId, table.employeeId, table.workDate),
    index("attendance_day_employee_idx").on(table.employeeId),
  ],
);

export const attendanceBuckets = pgTable(
  "attendance_buckets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** ROT | ROTND | SAT | SATND | SUN | SUNND | SH | RH | ND | ... */
    code: text("code").notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull().default("0"),
  },
  (table) => [
    uniqueIndex("attendance_bucket_unique_idx").on(table.runId, table.employeeId, table.code),
    index("attendance_bucket_employee_idx").on(table.employeeId),
  ],
);

/* ------------------------------------------------------------------ */
/* Pay runs                                                           */
/* ------------------------------------------------------------------ */

export const payRuns = pgTable(
  "pay_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    cutoffNo: smallint("cutoff_no").notNull(),
    cycleLabel: text("cycle_label").notNull(),
    /** draft | calculated | approved | void */
    status: text("status").notNull().default("draft"),
    statutoryVersion: text("statutory_version").notNull().default("PH-2026.1"),
    assumptions: jsonb("assumptions"),
    issues: jsonb("issues"),
    totals: jsonb("totals"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pay_run_period_idx").on(table.tenantId, table.periodId),
    index("pay_run_tenant_idx").on(table.tenantId),
  ],
);

export const payRunLines = pgTable(
  "pay_run_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payRuns.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    dailyRate: numeric("daily_rate", { precision: 12, scale: 4 }).notNull().default("0"),
    hourlyRate: numeric("hourly_rate", { precision: 12, scale: 4 }).notNull().default("0"),
    daysPaid: numeric("days_paid", { precision: 6, scale: 2 }).notNull().default("0"),
    basic: numeric("basic", { precision: 12, scale: 2 }).notNull().default("0"),
    allowance: numeric("allowance", { precision: 12, scale: 2 }).notNull().default("0"),
    overtime: numeric("overtime", { precision: 12, scale: 2 }).notNull().default("0"),
    nightDiff: numeric("night_diff", { precision: 12, scale: 2 }).notNull().default("0"),
    holiday: numeric("holiday", { precision: 12, scale: 2 }).notNull().default("0"),
    premium: numeric("premium", { precision: 12, scale: 2 }).notNull().default("0"),
    gross: numeric("gross", { precision: 12, scale: 2 }).notNull().default("0"),
    sssEmployee: numeric("sss_employee", { precision: 12, scale: 2 }).notNull().default("0"),
    sssEmployer: numeric("sss_employer", { precision: 12, scale: 2 }).notNull().default("0"),
    philhealthEmployee: numeric("philhealth_employee", { precision: 12, scale: 2 }).notNull().default("0"),
    philhealthEmployer: numeric("philhealth_employer", { precision: 12, scale: 2 }).notNull().default("0"),
    pagibigEmployee: numeric("pagibig_employee", { precision: 12, scale: 2 }).notNull().default("0"),
    pagibigEmployer: numeric("pagibig_employer", { precision: 12, scale: 2 }).notNull().default("0"),
    tax: numeric("tax", { precision: 12, scale: 2 }).notNull().default("0"),
    adjustmentEarning: numeric("adjustment_earning", { precision: 12, scale: 2 }).notNull().default("0"),
    otherDeductions: numeric("other_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
    netPay: numeric("net_pay", { precision: 12, scale: 2 }).notNull().default("0"),
    thirteenthAccrual: numeric("thirteenth_accrual", { precision: 12, scale: 2 }).notNull().default("0"),
    breakdown: jsonb("breakdown"),
  },
  (table) => [
    uniqueIndex("pay_run_line_employee_idx").on(table.runId, table.employeeId),
    index("pay_run_line_tenant_idx").on(table.tenantId),
  ],
);

/* ------------------------------------------------------------------ */
/* Payroll journal                                                    */
/* ------------------------------------------------------------------ */

export const glAccounts = pgTable(
  "gl_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** asset | liability | equity | income | expense */
    type: text("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("gl_account_tenant_code_idx").on(table.tenantId, table.code)],
);

export const payAccountMaps = pgTable(
  "pay_account_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    component: text("component").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => glAccounts.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("pay_account_map_idx").on(table.tenantId, table.component)],
);

export const payJournals = pgTable(
  "pay_journals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => payRuns.id, { onDelete: "cascade" }),
    /** draft | posted */
    status: text("status").notNull().default("draft"),
    totals: jsonb("totals"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [uniqueIndex("pay_journal_run_idx").on(table.tenantId, table.runId)],
);

export const payJournalLines = pgTable(
  "pay_journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => payJournals.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => glAccounts.id, { onDelete: "cascade" }),
    memo: text("memo"),
    debit: numeric("debit", { precision: 12, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 12, scale: 2 }).notNull().default("0"),
  },
  (table) => [index("pay_journal_line_journal_idx").on(table.journalId)],
);

export const paySettlements = pgTable("pay_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalId: uuid("journal_id")
    .notNull()
    .references(() => payJournals.id, { onDelete: "cascade" }),
  paidAt: date("paid_at").notNull(),
  method: text("method").notNull(),
  reference: text("reference"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Leaves                                                             */
/* ------------------------------------------------------------------ */

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    statutory: boolean("statutory").notNull().default(false),
    paid: boolean("paid").notNull().default(true),
    /** working | calendar */
    countingBasis: text("counting_basis").notNull().default("working"),
    annualDays: numeric("annual_days", { precision: 5, scale: 2 }).notNull().default("0"),
    carryOverCap: numeric("carry_over_cap", { precision: 5, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("leave_type_code_idx").on(table.tenantId, table.code)],
);

export const leavePolicies = pgTable(
  "leave_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    rankId: uuid("rank_id").references(() => ranks.id, { onDelete: "cascade" }),
    annualDays: numeric("annual_days", { precision: 5, scale: 2 }).notNull(),
    carryOverCap: numeric("carry_over_cap", { precision: 5, scale: 2 }).notNull().default("0"),
  },
  (table) => [index("leave_policy_tenant_idx").on(table.tenantId)],
);

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    granted: numeric("granted", { precision: 6, scale: 2 }).notNull().default("0"),
    carried: numeric("carried", { precision: 6, scale: 2 }).notNull().default("0"),
    used: numeric("used", { precision: 6, scale: 2 }).notNull().default("0"),
  },
  (table) => [
    uniqueIndex("leave_balance_idx").on(table.tenantId, table.employeeId, table.leaveTypeId, table.year),
    index("leave_balance_employee_idx").on(table.employeeId),
  ],
);

export const leaveEntries = pgTable(
  "leave_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    days: numeric("days", { precision: 5, scale: 2 }).notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("leave_entry_tenant_idx").on(table.tenantId)],
);

export const payAdjustments = pgTable(
  "pay_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** earning | deduction */
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    reason: text("reason"),
    /** queued | applied | cancelled */
    status: text("status").notNull().default("queued"),
    runId: uuid("run_id").references(() => payRuns.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [index("pay_adjustment_tenant_idx").on(table.tenantId, table.status)],
);

export type PayRun = typeof payRuns.$inferSelect;
export type PayRunLine = typeof payRunLines.$inferSelect;

export type Tenant = typeof tenants.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type User = typeof users.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type PayrollCalendar = typeof payrollCalendars.$inferSelect;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type WorkSchedule = typeof workSchedules.$inferSelect;
