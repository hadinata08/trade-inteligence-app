import { NextResponse } from "next/server";
import { getPrisma } from "@iti/database";
import Redis from "ioredis";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, string> = { app: "ok" };
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "down";
  }
  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 1500, lazyConnect: true });
    try {
      await redis.connect();
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "ok" : "down";
    } catch {
      checks.redis = "down";
    } finally {
      redis.disconnect();
    }
  }
  const ok = checks.database === "ok";
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
