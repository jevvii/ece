import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { employeeExternalIds, employees, workScheduleDays } from "@/db/schema";

/** One source of employee matching and schedule data for preview and save. */
export async function loadImportContext(tenantId: string) {
  const [employeeRows, externalIds] = await Promise.all([
    db.select({
      id: employees.id, employeeCode: employees.employeeCode,
      lastName: employees.lastName, firstName: employees.firstName, scheduleId: employees.scheduleId,
    }).from(employees).where(eq(employees.tenantId, tenantId)).orderBy(asc(employees.employeeCode)),
    db.select({ code: employeeExternalIds.code, employeeId: employeeExternalIds.employeeId })
      .from(employeeExternalIds).where(eq(employeeExternalIds.tenantId, tenantId)),
  ]);
  const scheduleIds = [...new Set(employeeRows.flatMap((employee) => employee.scheduleId ? [employee.scheduleId] : []))];
  const scheduleDays = scheduleIds.length
    ? await db.select().from(workScheduleDays).where(inArray(workScheduleDays.scheduleId, scheduleIds))
    : [];
  const schedules: Record<string, Record<number, number>> = {};
  for (const employee of employeeRows) {
    if (!employee.scheduleId) continue;
    const hours: Record<number, number> = {};
    for (const day of scheduleDays) {
      if (day.scheduleId !== employee.scheduleId) continue;
      if (!day.isWorkday || !day.startTime || !day.endTime) {
        hours[day.weekday] = 0;
        continue;
      }
      const [startHour = 0, startMinute = 0] = day.startTime.split(":").map(Number);
      const [endHour = 0, endMinute = 0] = day.endTime.split(":").map(Number);
      const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute) - day.breakMinutes;
      hours[day.weekday] = Math.max(0, minutes) / 60;
    }
    schedules[employee.id] = hours;
  }
  return { employees: employeeRows, externalIds, schedules };
}
