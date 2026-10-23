import { NextResponse } from "next/server";
import { SESSION_COOKIE, requestOrigin } from "@/lib/session";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", requestOrigin(request.headers, request.url)), 303);
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
