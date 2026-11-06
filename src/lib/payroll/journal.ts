import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { glAccounts, payAccountMaps } from "@/db/schema";
import { round2 } from "./statutory";

export const defaultAccounts = [
  { code: "6100", name: "Salaries and wages", type: "expense" },
  { code: "6110", name: "Allowances", type: "expense" },
  { code: "6120", name: "Overtime, holiday and premium pay", type: "expense" },
  { code: "6130", name: "SSS employer contribution", type: "expense" },
  { code: "6140", name: "PhilHealth employer contribution", type: "expense" },
  { code: "6150", name: "Pag-IBIG employer contribution", type: "expense" },
  { code: "6160", name: "13th month expense", type: "expense" },
  { code: "6170", name: "Adjustment earnings", type: "expense" },
  { code: "2200", name: "SSS contributions payable", type: "liability" },
  { code: "2210", name: "PhilHealth contributions payable", type: "liability" },
  { code: "2220", name: "Pag-IBIG contributions payable", type: "liability" },
  { code: "2230", name: "Withholding tax payable", type: "liability" },
  { code: "2240", name: "Accrued salaries payable", type: "liability" },
  { code: "2250", name: "Accrued 13th month payable", type: "liability" },
  { code: "2260", name: "Other deductions payable", type: "liability" },
] as const;

export const componentDefaults: Record<string, string> = {
  BASIC: "6100",
  ALLOWANCE: "6110",
  PREMIUM: "6120",
  SSS_ER: "6130",
  PH_ER: "6140",
  PI_ER: "6150",
  THIRTEENTH: "6160",
  ADJ_EARNING: "6170",
  SSS_PAYABLE: "2200",
  PH_PAYABLE: "2210",
  PI_PAYABLE: "2220",
  TAX: "2230",
  NET: "2240",
  THIRTEENTH_PAYABLE: "2250",
  OTHER_DEDUCTIONS: "2260",
};

export async function ensurePayrollAccounts(tenantId: string) {
  await db
    .insert(glAccounts)
    .values(defaultAccounts.map((account) => ({ ...account, tenantId })))
    .onConflictDoNothing({ target: [glAccounts.tenantId, glAccounts.code] });

  const accounts = await db.select().from(glAccounts).where(eq(glAccounts.tenantId, tenantId));
  const byCode = new Map(accounts.map((account) => [account.code, account]));

  const maps = Object.entries(componentDefaults)
    .map(([component, code]) => {
      const account = byCode.get(code);
      return account ? { tenantId, component, accountId: account.id } : null;
    })
    .filter((row): row is { tenantId: string; component: string; accountId: string } => Boolean(row));

  await db.insert(payAccountMaps).values(maps).onConflictDoNothing({
    target: [payAccountMaps.tenantId, payAccountMaps.component],
  });

  const stored = await db
    .select({ component: payAccountMaps.component, accountId: payAccountMaps.accountId })
    .from(payAccountMaps)
    .where(eq(payAccountMaps.tenantId, tenantId));

  return {
    accounts,
    byId: new Map(accounts.map((account) => [account.id, account])),
    componentAccount: new Map(stored.map((row) => [row.component, row.accountId])),
  };
}

export type JournalDraftLine = {
  component: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  memo: string;
  debit: number;
  credit: number;
};

export function buildJournalLines(
  totals: Record<string, number>,
  accounts: Awaited<ReturnType<typeof ensurePayrollAccounts>>,
): JournalDraftLine[] {
  const drafts: Array<{ component: string; memo: string; debit?: number; credit?: number }> = [
    { component: "BASIC", memo: "Basic pay", debit: totals.basic ?? 0 },
    { component: "ALLOWANCE", memo: "Allowances", debit: totals.allowance ?? 0 },
    {
      component: "PREMIUM",
      memo: "Overtime, night differential, holiday and premium",
      debit: round2((totals.overtime ?? 0) + (totals.nightDiff ?? 0) + (totals.holiday ?? 0) + (totals.premium ?? 0)),
    },
    { component: "ADJ_EARNING", memo: "Adjustment earnings", debit: totals.adjustmentEarning ?? 0 },
    { component: "SSS_ER", memo: "SSS employer share", debit: totals.sssEmployer ?? 0 },
    { component: "PH_ER", memo: "PhilHealth employer share", debit: totals.philhealthEmployer ?? 0 },
    { component: "PI_ER", memo: "Pag-IBIG employer share", debit: totals.pagibigEmployer ?? 0 },
    { component: "THIRTEENTH", memo: "13th month accrual", debit: totals.thirteenthAccrual ?? 0 },
    {
      component: "SSS_PAYABLE",
      memo: "SSS contributions payable",
      credit: round2((totals.sssEmployee ?? 0) + (totals.sssEmployer ?? 0)),
    },
    {
      component: "PH_PAYABLE",
      memo: "PhilHealth contributions payable",
      credit: round2((totals.philhealthEmployee ?? 0) + (totals.philhealthEmployer ?? 0)),
    },
    {
      component: "PI_PAYABLE",
      memo: "Pag-IBIG contributions payable",
      credit: round2((totals.pagibigEmployee ?? 0) + (totals.pagibigEmployer ?? 0)),
    },
    { component: "TAX", memo: "Withholding tax payable", credit: totals.tax ?? 0 },
    { component: "NET", memo: "Net pay payable", credit: totals.netPay ?? 0 },
    { component: "OTHER_DEDUCTIONS", memo: "Other deductions payable", credit: totals.otherDeductions ?? 0 },
    { component: "THIRTEENTH_PAYABLE", memo: "Accrued 13th month", credit: totals.thirteenthAccrual ?? 0 },
  ];

  return drafts.flatMap((draft) => {
    const accountId = accounts.componentAccount.get(draft.component);
    const account = accountId ? accounts.byId.get(accountId) : undefined;
    if (!accountId || !account) return [];

    const debit = round2(draft.debit ?? 0);
    const credit = round2(draft.credit ?? 0);
    if (debit === 0 && credit === 0) return [];

    return [
      {
        component: draft.component,
        accountId,
        accountCode: account.code,
        accountName: account.name,
        memo: draft.memo,
        debit,
        credit,
      },
    ];
  });
}

export async function accountMapsForTenant(tenantId: string) {
  return db
    .select({ component: payAccountMaps.component, accountId: payAccountMaps.accountId })
    .from(payAccountMaps)
    .where(and(eq(payAccountMaps.tenantId, tenantId)));
}
