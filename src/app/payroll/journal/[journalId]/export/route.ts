import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { glAccounts, payJournalLines, payJournals } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ journalId: string }> },
) {
  const { journalId } = await params;
  const { tenant } = await requireWorkspace();

  const [journal] = await db
    .select()
    .from(payJournals)
    .where(and(eq(payJournals.id, journalId), eq(payJournals.tenantId, tenant.id)))
    .limit(1);

  if (!journal) return new Response("Not found", { status: 404 });

  const lines = await db
    .select({ line: payJournalLines, account: glAccounts })
    .from(payJournalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, payJournalLines.accountId))
    .where(eq(payJournalLines.journalId, journal.id))
    .orderBy(asc(glAccounts.code));

  const rows = [
    ["Code", "Account", "Memo", "Debit", "Credit"],
    ...lines.map(({ line, account }) => [
      account.code,
      account.name,
      line.memo ?? "",
      Number(line.debit).toFixed(2),
      Number(line.credit).toFixed(2),
    ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payroll-journal-${journal.id.slice(0, 8)}.csv"`,
    },
  });
}
