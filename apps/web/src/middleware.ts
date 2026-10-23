import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession, requestOrigin } from "./lib/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path) || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }
  const secret = process.env.AUTH_SECRET || "";
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value, secret);
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Tidak masuk." }, { status: 401 });
    const login = new URL("/login", requestOrigin(request.headers, request.url));
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
