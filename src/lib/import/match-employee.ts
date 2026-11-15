import type { EmployeeLite } from "./apply-v2";

export const normalizeEmployeeCode = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const normalizeName = (value: string) => normalizeEmployeeCode(value).replace(/\s*,\s*/g, ", ");

/** Exact company-scoped matches only. Codes and reviewed aliases outrank names. */
export function createEmployeeMatcher(
  employees: EmployeeLite[],
  aliases: Array<{ code: string; employeeId: string }>,
) {
  const codes = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const add = (index: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    const ids = index.get(key) ?? new Set<string>();
    ids.add(id);
    index.set(key, ids);
  };
  for (const employee of employees) {
    add(codes, normalizeEmployeeCode(employee.employeeCode), employee.id);
    if (!employee.firstName.trim() || !employee.lastName.trim()) continue;
    add(names, normalizeName(`${employee.firstName} ${employee.lastName}`), employee.id);
    add(names, normalizeName(`${employee.lastName}, ${employee.firstName}`), employee.id);
  }
  const canonicalCodes = new Set(codes.keys());
  for (const alias of aliases) {
    const code = normalizeEmployeeCode(alias.code);
    if (employeeIds.has(alias.employeeId) && !canonicalCodes.has(code)) add(codes, code, alias.employeeId);
  }
  return (code: string, name: string): { employeeId?: string; ambiguous: boolean } => {
    const ids = codes.get(normalizeEmployeeCode(code)) ?? names.get(normalizeName(name));
    return { employeeId: ids?.size === 1 ? ids.values().next().value : undefined, ambiguous: (ids?.size ?? 0) > 1 };
  };
}
