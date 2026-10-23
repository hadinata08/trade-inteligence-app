import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "./session";

export async function currentSession() {
  const secret = process.env.AUTH_SECRET || "";
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value, secret);
}

export async function requireSession() {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

export function passwordsMatch(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
