import { NextResponse } from "next/server";
import { getCommodityChildren } from "@iti/analytics";
import { currentSession } from "@/lib/auth";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Tidak masuk." }, { status: 401 });
  const { code } = await context.params;
  const url = new URL(request.url);
  const parent = url.searchParams.get("parent");
  const period = url.searchParams.get("period") || "2024";
  if (!/^\d{1,10}$/.test(code) || (parent && !/^\d{2,8}$/.test(parent))) {
    return NextResponse.json({ error: "Kode tidak valid." }, { status: 400 });
  }
  const rows = await getCommodityChildren(code, parent, period);
  return NextResponse.json({ rows });
}
