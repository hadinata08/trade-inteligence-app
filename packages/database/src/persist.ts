import { createHash } from "node:crypto";
import { Prisma, type PartnerEntityType, type PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";
import {
  inferHsLevel,
  inferParentCode,
  observationIdentity,
  type CompletenessStatus,
} from "@iti/shared";
import { prepareObservationBatch, type IncomingObservation } from "./batch";
import { getPrisma } from "./client";

export type PartnerSeed = {
  m49Code: string;
  partnerName: string;
  iso2?: string | null;
  iso3?: string | null;
  region?: string | null;
  entityType: PartnerEntityType;
  activeStatus?: boolean;
};

export type PeriodSeed = {
  periodCode: string;
  frequency: "ANNUAL" | "MONTHLY";
  year: number;
  month: number | null;
  publicationStatus?: "PUBLISHED" | "ESTIMATED" | "NOT_PUBLISHED" | "UNKNOWN";
};

const CLASSIFICATION_CODE = "HS";
const CLASSIFICATION_REVISION = "H6";

function periodBounds(year: number, month: number | null): { start: Date; end: Date } {
  if (!month) {
    return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) };
  }
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0)),
  };
}

export async function upsertPartners(rows: PartnerSeed[], prisma: PrismaClient = getPrisma()): Promise<number> {
  let count = 0;
  for (const row of rows) {
    await prisma.partner.upsert({
      where: { m49Code: row.m49Code },
      create: {
        m49Code: row.m49Code,
        partnerName: row.partnerName.trim(),
        iso2: row.iso2?.trim() || null,
        iso3: row.iso3?.trim() || null,
        region: row.region ?? null,
        entityType: row.entityType,
        activeStatus: row.activeStatus ?? true,
      },
      update: {
        partnerName: row.partnerName.trim(),
        iso2: row.iso2?.trim() || null,
        iso3: row.iso3?.trim() || null,
        region: row.region ?? null,
        entityType: row.entityType,
        activeStatus: row.activeStatus ?? true,
      },
    });
    count += 1;
  }
  return count;
}

export async function upsertPeriods(rows: PeriodSeed[], prisma: PrismaClient = getPrisma()): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const row of rows) {
    const bounds = periodBounds(row.year, row.month);
    const saved = await prisma.reportingPeriod.upsert({
      where: { periodCode: row.periodCode },
      create: {
        periodCode: row.periodCode,
        frequency: row.frequency,
        year: row.year,
        month: row.month,
        startDate: bounds.start,
        endDate: bounds.end,
        publicationStatus: row.publicationStatus ?? "UNKNOWN",
      },
      update: {
        frequency: row.frequency,
        year: row.year,
        month: row.month,
        publicationStatus: row.publicationStatus ?? "UNKNOWN",
      },
    });
    ids.set(row.periodCode, saved.id);
  }
  return ids;
}

export async function ensureClassification(
  sourceMetadata: Prisma.InputJsonValue = { source: "UN Comtrade HS" },
  prisma: PrismaClient = getPrisma(),
): Promise<string> {
  const saved = await prisma.hsClassification.upsert({
    where: {
      classificationCode_revision: {
        classificationCode: CLASSIFICATION_CODE,
        revision: CLASSIFICATION_REVISION,
      },
    },
    create: {
      classificationCode: CLASSIFICATION_CODE,
      revision: CLASSIFICATION_REVISION,
      effectivePeriod: "2017-2026",
      sourceMetadata,
    },
    update: { sourceMetadata },
  });
  return saved.id;
}

export type PersistResult = {
  stored: number;
  conflicts: number;
  revisions: number;
  removed: number;
};

export async function persistObservations(
  rows: IncomingObservation[],
  options: {
    replaceScope?: {
      partnerCodes: string[];
      periodCodes: string[];
      flows: Array<"EXPORT" | "IMPORT">;
      hsLevel: number;
    } | null;
  } = {},
  prisma: PrismaClient = getPrisma(),
): Promise<PersistResult> {
  const prepared = prepareObservationBatch(rows);
  if (prepared.conflicts.length) {
    await prisma.observationConflict.createMany({
      data: prepared.conflicts.map((conflict) => ({
        identityKey: conflict.identityKey,
        values: conflict.values,
      })),
    });
  }

  if (!prepared.ready.length && !options.replaceScope) {
    return { stored: 0, conflicts: prepared.conflicts.length, revisions: 0, removed: 0 };
  }

  const classificationId = await ensureClassification({ source: prepared.ready[0]?.sourceKind ?? "UN_COMTRADE" }, prisma);
  await ensurePartners(prepared.ready, prisma);
  const periodIds = await upsertPeriods(
    uniquePeriods(prepared.ready.length ? prepared.ready : []),
    prisma,
  );
  if (options.replaceScope) {
    const extra = options.replaceScope.periodCodes
      .filter((code) => !periodIds.has(code))
      .map((code) => periodFromCode(code))
      .filter((row): row is PeriodSeed => row != null);
    const more = await upsertPeriods(extra, prisma);
    for (const [code, id] of more) periodIds.set(code, id);
  }

  const commodityIds = await upsertCommodities(prepared.ready, classificationId, prisma);
  const records = prepared.ready.map((row) => {
    const commodityId = commodityIds.get(row.hsCode);
    const periodId = periodIds.get(row.periodCode);
    if (!commodityId || !periodId || row.tradeValueUsd == null) {
      throw new Error(`Missing commodity or period for ${row.hsCode} ${row.periodCode}`);
    }
    const identityKey = observationIdentity({
      reporterCode: row.reporterCode,
      partnerCode: row.partnerCode,
      secondPartnerCode: row.secondPartnerCode,
      periodId,
      flow: row.flow,
      commodityId,
      customsCode: row.customsCode,
      transportMode: row.transportMode,
    });
    return { identityKey, row, commodityId, periodId };
  });

  // Stable ids would change if we include a random cuid. Identity key is the real key.
  // Use a deterministic id only on insert; conflict update keeps the original id.
  let revisions = 0;
  let removed = 0;
  const chunkSize = 200;
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    revisions += await writeChunk(prisma, chunk);
  }

  if (options.replaceScope && prepared.conflicts.length === 0) {
    removed = await deleteRowsMissingFromScope(prisma, options.replaceScope, periodIds, new Set(records.map((record) => record.identityKey)));
  }

  const partnerCodes = [
    ...new Set([
      ...prepared.ready.map((row) => row.partnerCode),
      ...(options.replaceScope?.partnerCodes ?? []),
    ]),
  ];
  const affectedPeriodIds = [
    ...new Set([
      ...records.map((record) => record.periodId),
      ...(options.replaceScope?.periodCodes.map((code) => periodIds.get(code)).filter((id): id is string => Boolean(id)) ?? []),
    ]),
  ];
  if (partnerCodes.length && affectedPeriodIds.length) {
    await refreshSummaries(prisma, partnerCodes, affectedPeriodIds);
  }

  return {
    stored: records.length,
    conflicts: prepared.conflicts.length,
    revisions,
    removed,
  };
}

async function ensurePartners(rows: IncomingObservation[], prisma: PrismaClient) {
  const codes = new Set<string>(["0"]);
  for (const row of rows) {
    codes.add(row.partnerCode);
    codes.add(row.secondPartnerCode);
  }
  const existing = await prisma.partner.findMany({
    where: { m49Code: { in: [...codes] } },
    select: { m49Code: true },
  });
  const have = new Set(existing.map((partner) => partner.m49Code));
  for (const code of codes) {
    if (have.has(code)) continue;
    const sample = rows.find((row) => row.partnerCode === code);
    await prisma.partner.create({
      data: {
        m49Code: code,
        partnerName: sample?.partnerName?.trim() || (code === "0" ? "World" : `Partner ${code}`),
        entityType: code === "0" ? "AGGREGATE" : "OTHER",
        activeStatus: true,
      },
    });
  }
}

function uniquePeriods(rows: IncomingObservation[]): PeriodSeed[] {
  const map = new Map<string, PeriodSeed>();
  for (const row of rows) {
    if (!map.has(row.periodCode)) {
      map.set(row.periodCode, {
        periodCode: row.periodCode,
        frequency: row.frequency,
        year: row.year,
        month: row.month,
      });
    }
  }
  return [...map.values()];
}

function periodFromCode(code: string): PeriodSeed | null {
  if (/^\d{4}$/.test(code)) {
    return { periodCode: code, frequency: "ANNUAL", year: Number(code), month: null };
  }
  if (/^\d{6}$/.test(code)) {
    return {
      periodCode: code,
      frequency: "MONTHLY",
      year: Number(code.slice(0, 4)),
      month: Number(code.slice(4)),
    };
  }
  return null;
}

async function upsertCommodities(
  rows: IncomingObservation[],
  classificationId: string,
  prisma: PrismaClient,
): Promise<Map<string, string>> {
  const byCode = new Map<string, IncomingObservation>();
  for (const row of rows) {
    if (!byCode.has(row.hsCode)) byCode.set(row.hsCode, row);
  }
  const codes = [...byCode.keys()];
  const existing = await prisma.hsCommodity.findMany({
    where: { classificationId, hsCode: { in: codes } },
  });
  const ids = new Map(existing.map((commodity) => [commodity.hsCode, commodity.id]));
  for (const [hsCode, row] of byCode) {
    const level = row.hsLevel || inferHsLevel(hsCode);
    const parentCode = row.parentCode ?? inferParentCode(hsCode);
    if (ids.has(hsCode)) {
      await prisma.hsCommodity.update({
        where: { id: ids.get(hsCode) },
        data: {
          description: row.description || hsCode,
          hsLevel: level,
          parentCode,
          isAggregate: hsCode === "TOTAL" || level === 0,
        },
      });
      continue;
    }
    const created = await prisma.hsCommodity.create({
      data: {
        classificationId,
        hsCode,
        hsLevel: level,
        parentCode,
        description: row.description || hsCode,
        isAggregate: hsCode === "TOTAL" || level === 0,
      },
    });
    ids.set(hsCode, created.id);
  }
  return ids;
}

async function writeChunk(
  prisma: PrismaClient,
  chunk: Array<{
    identityKey: string;
    row: IncomingObservation;
    commodityId: string;
    periodId: string;
  }>,
): Promise<number> {
  const existing = await prisma.tradeObservation.findMany({
    where: { identityKey: { in: chunk.map((item) => item.identityKey) } },
    select: { id: true, identityKey: true, tradeValueUsd: true },
  });
  const current = new Map(existing.map((row) => [row.identityKey, row]));
  const revisions: Prisma.SourceRevisionCreateManyInput[] = [];
  for (const item of chunk) {
    const previous = current.get(item.identityKey);
    if (!previous || item.row.tradeValueUsd == null) continue;
    const before = new Decimal(previous.tradeValueUsd.toString()).toFixed(2);
    const after = new Decimal(item.row.tradeValueUsd).toFixed(2);
    if (before === after) continue;
    revisions.push({
      observationIdentity: item.identityKey,
      observationId: previous.id,
      originalValue: before,
      revisedValue: after,
      sourceUpdate: item.row.sourceStatus,
      revisionTimestamp: new Date(),
    });
  }
  if (revisions.length) await prisma.sourceRevision.createMany({ data: revisions });

  const values = chunk.map((item) => {
    const row = item.row;
      return Prisma.sql`(
      ${observationRowId(item.identityKey)},
      ${item.identityKey},
      ${row.reporterCode},
      ${row.partnerCode},
      ${row.secondPartnerCode},
      ${item.periodId},
      CAST(${row.flow} AS "TradeFlow"),
      ${item.commodityId},
      ${row.hsLevel},
      ${row.customsCode},
      ${row.transportMode},
      CAST(${row.tradeValueUsd} AS DECIMAL(24, 2)),
      ${row.quantity == null ? null : Prisma.sql`CAST(${row.quantity} AS DECIMAL(24, 6))`},
      ${row.netWeight == null ? null : Prisma.sql`CAST(${row.netWeight} AS DECIMAL(24, 6))`},
      ${row.sourceStatus},
      ${row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null},
      NOW(),
      CAST(${row.sourceKind} AS "DataSourceKind"),
      ${row.isReported},
      ${row.classificationCode},
      ${row.hsCode}
    )`;
  });

  await prisma.$executeRaw`
    INSERT INTO trade_observations (
      id, identity_key, reporter_code, partner_code, second_partner_code, period_id, flow,
      commodity_id, aggregation_level, customs_code, transport_mode, trade_value_usd,
      quantity, net_weight, source_status, source_updated_at, ingested_at, source_kind,
      is_reported, classification_code, cmd_code
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT (identity_key) DO UPDATE SET
      trade_value_usd = EXCLUDED.trade_value_usd,
      quantity = EXCLUDED.quantity,
      net_weight = EXCLUDED.net_weight,
      source_status = EXCLUDED.source_status,
      source_updated_at = EXCLUDED.source_updated_at,
      ingested_at = NOW(),
      source_kind = EXCLUDED.source_kind,
      is_reported = EXCLUDED.is_reported,
      classification_code = EXCLUDED.classification_code,
      cmd_code = EXCLUDED.cmd_code,
      aggregation_level = EXCLUDED.aggregation_level
  `;
  return revisions.length;
}

async function deleteRowsMissingFromScope(
  prisma: PrismaClient,
  scope: {
    partnerCodes: string[];
    periodCodes: string[];
    flows: Array<"EXPORT" | "IMPORT">;
    hsLevel: number;
  },
  periodIds: Map<string, string>,
  keep: Set<string>,
): Promise<number> {
  const ids = scope.periodCodes.map((code) => periodIds.get(code)).filter((id): id is string => Boolean(id));
  if (!scope.partnerCodes.length || !ids.length || !scope.flows.length) return 0;
  const existing = await prisma.tradeObservation.findMany({
    where: {
      partnerCode: { in: scope.partnerCodes },
      periodId: { in: ids },
      flow: { in: scope.flows },
      aggregationLevel: scope.hsLevel,
    },
    select: { id: true, identityKey: true },
  });
  const stale = existing.filter((row) => !keep.has(row.identityKey)).map((row) => row.id);
  if (!stale.length) return 0;
  const result = await prisma.tradeObservation.deleteMany({ where: { id: { in: stale } } });
  return result.count;
}

export async function refreshSummaries(
  prisma: PrismaClient,
  partnerCodes: string[],
  periodIds: string[],
): Promise<void> {
  if (!partnerCodes.length || !periodIds.length) return;
  await prisma.$executeRaw`
    INSERT INTO partner_period_summaries (
      id, partner_code, period_id, export_usd, import_usd, export_present, import_present,
      completeness, source_updated_at, source_kind, refreshed_at
    )
    SELECT
      md5(o.partner_code || '|' || o.period_id),
      o.partner_code,
      o.period_id,
      CASE WHEN COUNT(*) FILTER (WHERE o.flow = 'EXPORT') = 0 THEN NULL
           ELSE SUM(o.trade_value_usd) FILTER (WHERE o.flow = 'EXPORT') END,
      CASE WHEN COUNT(*) FILTER (WHERE o.flow = 'IMPORT') = 0 THEN NULL
           ELSE SUM(o.trade_value_usd) FILTER (WHERE o.flow = 'IMPORT') END,
      COUNT(*) FILTER (WHERE o.flow = 'EXPORT') > 0,
      COUNT(*) FILTER (WHERE o.flow = 'IMPORT') > 0,
      CASE
        WHEN COUNT(*) FILTER (WHERE o.flow = 'EXPORT') > 0 AND COUNT(*) FILTER (WHERE o.flow = 'IMPORT') > 0
          THEN 'COMPLETE'::"CompletenessStatus"
        WHEN COUNT(*) FILTER (WHERE o.flow = 'EXPORT') > 0 OR COUNT(*) FILTER (WHERE o.flow = 'IMPORT') > 0
          THEN 'PARTIAL'::"CompletenessStatus"
        ELSE 'MISSING'::"CompletenessStatus"
      END,
      MAX(o.source_updated_at),
      CASE WHEN BOOL_OR(o.source_kind = 'FIXTURE') THEN 'FIXTURE'::"DataSourceKind"
           ELSE 'UN_COMTRADE'::"DataSourceKind" END,
      NOW()
    FROM trade_observations o
    JOIN hs_commodities c ON c.id = o.commodity_id
    WHERE c.hs_code = 'TOTAL'
      AND o.partner_code IN (${Prisma.join(partnerCodes)})
      AND o.period_id IN (${Prisma.join(periodIds)})
    GROUP BY o.partner_code, o.period_id
    ON CONFLICT (partner_code, period_id) DO UPDATE SET
      export_usd = EXCLUDED.export_usd,
      import_usd = EXCLUDED.import_usd,
      export_present = EXCLUDED.export_present,
      import_present = EXCLUDED.import_present,
      completeness = EXCLUDED.completeness,
      source_updated_at = EXCLUDED.source_updated_at,
      source_kind = EXCLUDED.source_kind,
      refreshed_at = NOW()
  `;

  await prisma.$executeRaw`
    INSERT INTO commodity_period_summaries (
      id, partner_code, period_id, commodity_id, hs_code, hs_level,
      export_usd, import_usd, export_present, import_present, refreshed_at
    )
    SELECT
      md5(o.partner_code || '|' || o.period_id || '|' || o.commodity_id),
      o.partner_code,
      o.period_id,
      o.commodity_id,
      c.hs_code,
      c.hs_level,
      CASE WHEN COUNT(*) FILTER (WHERE o.flow = 'EXPORT') = 0 THEN NULL
           ELSE SUM(o.trade_value_usd) FILTER (WHERE o.flow = 'EXPORT') END,
      CASE WHEN COUNT(*) FILTER (WHERE o.flow = 'IMPORT') = 0 THEN NULL
           ELSE SUM(o.trade_value_usd) FILTER (WHERE o.flow = 'IMPORT') END,
      COUNT(*) FILTER (WHERE o.flow = 'EXPORT') > 0,
      COUNT(*) FILTER (WHERE o.flow = 'IMPORT') > 0,
      NOW()
    FROM trade_observations o
    JOIN hs_commodities c ON c.id = o.commodity_id
    WHERE c.hs_code <> 'TOTAL'
      AND o.partner_code IN (${Prisma.join(partnerCodes)})
      AND o.period_id IN (${Prisma.join(periodIds)})
    GROUP BY o.partner_code, o.period_id, o.commodity_id, c.hs_code, c.hs_level
    ON CONFLICT (partner_code, period_id, commodity_id) DO UPDATE SET
      hs_code = EXCLUDED.hs_code,
      hs_level = EXCLUDED.hs_level,
      export_usd = EXCLUDED.export_usd,
      import_usd = EXCLUDED.import_usd,
      export_present = EXCLUDED.export_present,
      import_present = EXCLUDED.import_present,
      refreshed_at = NOW()
  `;

  await prisma.$executeRaw`
    DELETE FROM partner_period_summaries s
    WHERE s.partner_code IN (${Prisma.join(partnerCodes)})
      AND s.period_id IN (${Prisma.join(periodIds)})
      AND NOT EXISTS (
        SELECT 1
        FROM trade_observations o
        JOIN hs_commodities c ON c.id = o.commodity_id
        WHERE o.partner_code = s.partner_code
          AND o.period_id = s.period_id
          AND c.hs_code = 'TOTAL'
      )
  `;

  await prisma.$executeRaw`
    DELETE FROM commodity_period_summaries s
    WHERE s.partner_code IN (${Prisma.join(partnerCodes)})
      AND s.period_id IN (${Prisma.join(periodIds)})
      AND NOT EXISTS (
        SELECT 1
        FROM trade_observations o
        WHERE o.partner_code = s.partner_code
          AND o.period_id = s.period_id
          AND o.commodity_id = s.commodity_id
      )
  `;
}

function observationRowId(identityKey: string): string {
  return `obs_${createHash("sha256").update(identityKey).digest("hex").slice(0, 32)}`;
}

export function completenessFromPresence(exportPresent: boolean, importPresent: boolean): CompletenessStatus {
  if (exportPresent && importPresent) return "COMPLETE";
  if (exportPresent || importPresent) return "PARTIAL";
  return "MISSING";
}
