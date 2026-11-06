CREATE TABLE "attendance_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"code" text NOT NULL,
	"hours" numeric(6, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"source_value" text
);
--> statement-breakpoint
CREATE TABLE "import_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"mapping" jsonb NOT NULL,
	"source_signature" text,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid,
	"period_id" uuid,
	"file_name" text NOT NULL,
	"file_kind" text NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"storage_key" text,
	"status" text DEFAULT 'mapping' NOT NULL,
	"mapping" jsonb NOT NULL,
	"issues" jsonb,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_buckets" ADD CONSTRAINT "attendance_buckets_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_buckets" ADD CONSTRAINT "attendance_buckets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_buckets" ADD CONSTRAINT "attendance_buckets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_profile_id_import_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."import_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_bucket_unique_idx" ON "attendance_buckets" USING btree ("run_id","employee_id","code");--> statement-breakpoint
CREATE INDEX "attendance_bucket_employee_idx" ON "attendance_buckets" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_day_unique_idx" ON "attendance_days" USING btree ("run_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_day_employee_idx" ON "attendance_days" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "import_profiles_tenant_idx" ON "import_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "import_runs_tenant_idx" ON "import_runs" USING btree ("tenant_id");