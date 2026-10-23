import { NextResponse } from "next/server";
import { getPrisma } from "@iti/database";
import { currentSession } from "@/lib/auth";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Tidak masuk." }, { status: 401 });
  const { id } = await context.params;
  const job = await getPrisma().exportJob.findUnique({ where: { exportId: id } });
  if (!job) return NextResponse.json({ error: "Ekspor tidak ditemukan." }, { status: 404 });
  return NextResponse.json({ status: job.status, progress: job.progress, error: job.error, fileName: job.fileName });
}
