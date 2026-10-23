import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getPrisma } from "@iti/database";
import { enqueueExcelExport } from "@iti/comtrade";
import { ExportFiltersSchema, fullReportFilters } from "@iti/shared";
import { currentSession } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Tidak masuk." }, { status: 401 });
  const raw = await request.json().catch(() => null);
  const parsed = ExportFiltersSchema.safeParse(raw?.preset === "full" ? fullReportFilters() : raw);
  if (!parsed.success) return NextResponse.json({ error: "Filter ekspor tidak valid." }, { status: 400 });
  const exportId = randomUUID();
  await getPrisma().exportJob.create({
    data: {
      exportId,
      requestedBy: session.email,
      filters: parsed.data,
      status: "QUEUED",
      progress: { stage: "Antrean", countriesCompleted: 0, countriesTotal: 0, rowsGenerated: 0, bytes: 0, warnings: [] },
    },
  });
  await getPrisma().auditLog.create({ data: { actor: session.email, action: "export.create", metadata: { exportId, preset: parsed.data.preset } } });
  try {
    await enqueueExcelExport(exportId);
  } catch (error) {
    await getPrisma().exportJob.update({
      where: { exportId },
      data: { status: "FAILED", error: error instanceof Error ? error.message : "Redis tidak tersedia." },
    });
    return NextResponse.json({ error: "Redis belum siap untuk antrean ekspor." }, { status: 503 });
  }
  return NextResponse.json({ exportId });
}
