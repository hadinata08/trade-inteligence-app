import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getPrisma } from "@iti/database";
import { currentSession } from "@/lib/auth";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Tidak masuk." }, { status: 401 });
  const { id } = await context.params;
  const job = await getPrisma().exportJob.findUnique({ where: { exportId: id } });
  if (!job?.fileLocation || job.status !== "COMPLETED") return NextResponse.json({ error: "Berkas belum siap." }, { status: 404 });
  const root = path.resolve(process.env.EXPORT_STORAGE_PATH || path.join(process.cwd(), "exports"));
  const file = path.resolve(job.fileLocation);
  if (!file.startsWith(root + path.sep)) return NextResponse.json({ error: "Lokasi berkas ditolak." }, { status: 400 });
  const info = await stat(file);
  await getPrisma().auditLog.create({ data: { actor: session.email, action: "export.download", metadata: { exportId: id } } });
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  const filename = job.fileName || "INDONESIA_TRADE_INTELLIGENCE.xlsx";
  return new NextResponse(stream, {
    headers: {
      "content-type": filename.endsWith(".zip") ? "application/zip" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-length": String(info.size),
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
}
