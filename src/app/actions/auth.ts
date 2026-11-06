"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, sessions, users } from "@/db/schema";
import {
  SESSION_COOKIE,
  newSessionToken,
  sessionCookieOptions,
  sessionExpiry,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    redirect(`/sign-in?error=missing&next=${encodeURIComponent(next)}`);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    redirect(`/sign-in?error=invalid&next=${encodeURIComponent(next)}`);
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .orderBy(asc(memberships.createdAt))
    .limit(1);

  const token = newSessionToken();
  await db.insert(sessions).values({
    token,
    userId: user.id,
    tenantId: membership?.tenantId ?? null,
    expiresAt: sessionExpiry(),
  });

  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  redirect(next);
}

export async function signOutAction() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }

  store.delete(SESSION_COOKIE);
  redirect("/sign-in");
}

export async function switchCompanyAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !tenantId) redirect("/");

  const [session] = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
  if (!session) redirect("/sign-in");

  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, tenantId)))
    .limit(1);

  if (!membership) redirect("/");

  await db.update(sessions).set({ tenantId }).where(eq(sessions.token, token));

  // Stay on the screen the user was on; the header is shared by every module.
  const referer = (await headers()).get("referer");
  let target = "/payroll";

  if (referer) {
    try {
      const url = new URL(referer);
      if (url.pathname.startsWith("/") && !url.pathname.startsWith("//")) {
        target = `${url.pathname}${url.search}`;
      }
    } catch {
      // keep the default
    }
  }

  redirect(target);
}
