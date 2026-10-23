import { getDatasetBanner, listPeriodOptions } from "@iti/analytics";
import { GenerateForm } from "@/components/generate-form";

export default async function GeneratePage() {
  const [periods, banner] = await Promise.all([
    listPeriodOptions().catch(() => []),
    getDatasetBanner().catch(() => null),
  ]);
  return (
    <GenerateForm
      periods={periods}
      banner={banner ? { sourceKind: banner.sourceKind, lastSyncedAt: banner.lastSyncedAt, notes: banner.notes } : null}
    />
  );
}
