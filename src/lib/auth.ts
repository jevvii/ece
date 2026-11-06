import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, sessions, tenants, users } from "@/db/schema";

export const SESSION_COOKIE = "ece_session";
const SESSION_DAYS = 7;

export type WorkspaceContext = {
  user: typeof users.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  membership: typeof memberships.$inferSelect;
  memberships: Array<{
    tenant: typeof tenants.$inferSelect;
    membership: typeof memberships.$inferSelect;
  }>;
  sessionToken: string;
};

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function requireWorkspace(): Promise<WorkspaceContext> {
  const session = await requireUser();

  const rows = await db
    .select({ tenant: tenants, membership: memberships })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, session.user.id))
    .orderBy(asc(memberships.createdAt));

  if (rows.length === 0) redirect("/sign-in?error=no-company");

  const active =
    rows.find((row) => row.tenant.id === session.session.tenantId) ?? rows[0];

  if (!active) redirect("/sign-in?error=no-company");

  return {
    user: session.user,
    tenant: active.tenant,
    membership: active.membership,
    memberships: rows,
    sessionToken: session.session.token,
  };
}

export function newSessionToken() {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

export const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};
