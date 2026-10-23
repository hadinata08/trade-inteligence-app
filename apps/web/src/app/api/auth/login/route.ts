import { NextResponse } from "next/server";
import { getPrisma } from "@iti/database";
import { LoginSchema } from "@iti/shared";
import { passwordsMatch } from "@/lib/auth";
import { SESSION_COOKIE, signSession } from "@/lib/session";

const attempts = new Map<string, { count: number; reset: number }>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const bucket = attempts.get(ip);
  if (bucket && bucket.reset > now && bucket.count >= 8) {
    return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, { status: 429 });
  }
  const parsed = LoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email atau kata sandi tidak valid." }, { status: 400 });
  const email = process.env.ADMIN_EMAIL || "";
  const password = process.env.ADMIN_PASSWORD || "";
  const secret = process.env.AUTH_SECRET || "";
  if (secret.length < 16 || password.length < 12 || !email) {
    return NextResponse.json({ error: "AUTH_SECRET, ADMIN_EMAIL, dan ADMIN_PASSWORD belum dikonfigurasi." }, { status: 503 });
  }
  const valid = parsed.data.email.toLowerCase() === email.toLowerCase() && passwordsMatch(parsed.data.password, password);
  if (!valid) {
    attempts.set(ip, { count: (bucket && bucket.reset > now ? bucket.count : 0) + 1, reset: now + 15 * 60 * 1000 });
    return NextResponse.json({ error: "Email atau kata sandi salah." }, { status: 401 });
  }
  attempts.delete(ip);
  const token = await signSession({ email, role: "admin", exp: Date.now() + 12 * 60 * 60 * 1000 }, secret);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") ?? false,
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  await getPrisma().auditLog.create({ data: { actor: email, action: "login", metadata: { ip } } }).catch(() => undefined);
  return response;
}
