CREATE TABLE "pay_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"daily_rate" numeric(12, 4) DEFAULT '0' NOT NULL,
	"hourly_rate" numeric(12, 4) DEFAULT '0' NOT NULL,
	"days_paid" numeric(6, 2) DEFAULT '0' NOT NULL,
	"basic" numeric(12, 2) DEFAULT '0' NOT NULL,
	"allowance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"overtime" numeric(12, 2) DEFAULT '0' NOT NULL,
	"night_diff" numeric(12, 2) DEFAULT '0' NOT NULL,
	"holiday" numeric(12, 2) DEFAULT '0' NOT NULL,
	"premium" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gross" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sss_employee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sss_employer" numeric(12, 2) DEFAULT '0' NOT NULL,
	"philhealth_employee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"philhealth_employer" numeric(12, 2) DEFAULT '0' NOT NULL,
	"pagibig_employee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"pagibig_employer" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"other_deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(12, 2) DEFAULT '0' NOT NULL,
	"thirteenth_accrual" numeric(12, 2) DEFAULT '0' NOT NULL,
	"breakdown" jsonb
);
--> statement-breakpoint
CREATE TABLE "pay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"cutoff_no" smallint NOT NULL,
	"cycle_label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"statutory_version" text DEFAULT 'PH-2026.1' NOT NULL,
	"assumptions" jsonb,
	"issues" jsonb,
	"totals" jsonb,
	"created_by" uuid,
	"calculated_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "monthly_allowance" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_run_lines" ADD CONSTRAINT "pay_run_lines_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pay_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_run_lines" ADD CONSTRAINT "pay_run_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_run_lines" ADD CONSTRAINT "pay_run_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_run_line_employee_idx" ON "pay_run_lines" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "pay_run_line_tenant_idx" ON "pay_run_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_run_period_idx" ON "pay_runs" USING btree ("tenant_id","period_id");--> statement-breakpoint
CREATE INDEX "pay_run_tenant_idx" ON "pay_runs" USING btree ("tenant_id");