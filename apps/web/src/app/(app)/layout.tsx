import { Shell } from "@/components/shell";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <Shell email={session.email}>{children}</Shell>;
}
