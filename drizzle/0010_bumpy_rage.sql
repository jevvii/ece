CREATE TABLE "attendance_late_totals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ADD COLUMN "late_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_late_totals" ADD CONSTRAINT "attendance_late_totals_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_late_totals" ADD CONSTRAINT "attendance_late_totals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_late_totals" ADD CONSTRAINT "attendance_late_totals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_late_total_idx" ON "attendance_late_totals" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "attendance_late_total_tenant_idx" ON "attendance_late_totals" USING btree ("tenant_id");