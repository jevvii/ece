import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "ece_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // Only block requests that carry no session at all. A cookie whose session
  // has expired or belongs to another database must fall through to the page,
  // which checks the database — otherwise / and /sign-in redirect to each other
  // forever. The sign-in page is what sends an already-valid user onward.
  if (!hasSession && pathname !== "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // `api/health` must stay public: Render probes it before traffic is routed.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
