import { NextResponse } from "next/server";
import { getSyncOverview } from "@iti/analytics";
import { getPrisma } from "@iti/database";
import {
  ComtradeClient,
  InMemoryRateLimiter,
  loadFixtureDataset,
  refreshCountry,
  refreshPeriod,
  retryFailedJobs,
  retryIncomplete,
  setQueuesPaused,
  setSyncPaused,
  startLiveBackfill,
} from "@iti/comtrade";
import { SyncActionSchema } from "@iti/shared";
import { currentSession } from "@/lib/auth";
import { isTrustedOrigin } from "@/lib/session";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Tidak masuk." }, { status: 401 });
  try {
    return NextResponse.json(await getSyncOverview());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal membaca status." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Tidak masuk." }, { status: 401 });
  if (!isTrustedOrigin(request.headers, request.url, request.headers.get("origin"))) {
    return NextResponse.json({ error: "Origin ditolak." }, { status: 403 });
  }
  const parsed = SyncActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Aksi tidak valid." }, { status: 400 });
  const action = parsed.data;
  const prisma = getPrisma();
  try {
    if (action.action === "load-fixture") await loadFixtureDataset(prisma);
    if (action.action === "start-backfill") {
      const key = process.env.COMTRADE_API_KEY?.trim();
      if (!key) return NextResponse.json({ error: "COMTRADE_API_KEY kosong. Muat data contoh atau isi kunci di server." }, { status: 400 });
      const client = new ComtradeClient({
        apiKey: key,
        rateLimiter: new InMemoryRateLimiter({
          budget: Number(process.env.COMTRADE_DAILY_REQUEST_BUDGET || 450),
          intervalMs: Number(process.env.COMTRADE_MIN_REQUEST_INTERVAL_MS || 1500),
          windowMs: Number(process.env.COMTRADE_QUOTA_WINDOW_HOURS || 24) * 60 * 60 * 1000,
        }),
      });
      await startLiveBackfill(client, prisma);
    }
    if (action.action === "pause") {
      await setSyncPaused(true, prisma);
      if (process.env.REDIS_URL) await setQueuesPaused(process.env.REDIS_URL, true);
    }
    if (action.action === "resume") {
      await setSyncPaused(false, prisma);
      if (process.env.REDIS_URL) await setQueuesPaused(process.env.REDIS_URL, false);
    }
    if (action.action === "retry-failed") await retryFailedJobs(prisma);
    if (action.action === "retry-incomplete") await retryIncomplete(prisma);
    if (action.action === "refresh-country") await refreshCountry(action.partnerCode, prisma);
    if (action.action === "refresh-period") await refreshPeriod(action.periodCode, prisma);
    await prisma.auditLog.create({ data: { actor: session.email, action: `sync.${action.action}`, metadata: action } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Aksi gagal." }, { status: 500 });
  }
}
