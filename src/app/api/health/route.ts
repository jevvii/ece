import { NextResponse } from "next/server";
import { sql } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Deployment health check. Kept unauthenticated (see the exclusion in
 * `src/proxy.ts`) so Render can probe it before the service receives traffic.
 */
export async function GET() {
  try {
    await sql`select 1`;
    return NextResponse.json({ ok: true, database: "up" });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503 });
  }
}
