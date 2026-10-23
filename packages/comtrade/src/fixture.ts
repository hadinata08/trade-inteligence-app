import type { IncomingObservation } from "@iti/database";
import { REPORTER, allSourcePeriodCodes, inferHsLevel, inferParentCode } from "@iti/shared";
import Decimal from "decimal.js";
import { normalizeComtradePayload } from "./normalize";
import { bundledPartners } from "./reference";
import type { TariffAvailability, TradeQuery, TradeSource } from "./types";

export const FIXTURE_PARTNER_CODES = [
  "156",
  "392",
  "842",
  "702",
  "458",
  "356",
  "410",
  "764",
  "704",
  "36",
  "276",
  "528",
  "608",
  "158",
  "784",
  "682",
] as const;

const PARTNER_BASE: Record<string, { exportUsd: string; importUsd: string }> = {
  "156": { exportUsd: "45000000000", importUsd: "62000000000" },
  "392": { exportUsd: "18000000000", importUsd: "15000000000" },
  "842": { exportUsd: "24000000000", importUsd: "12000000000" },
  "702": { exportUsd: "14000000000", importUsd: "16000000000" },
  "458": { exportUsd: "11000000000", importUsd: "9000000000" },
  "356": { exportUsd: "16000000000", importUsd: "7000000000" },
  "410": { exportUsd: "9000000000", importUsd: "8500000000" },
  "764": { exportUsd: "7000000000", importUsd: "8000000000" },
  "704": { exportUsd: "6500000000", importUsd: "5000000000" },
  "36": { exportUsd: "4000000000", importUsd: "5500000000" },
  "276": { exportUsd: "3200000000", importUsd: "3800000000" },
  "528": { exportUsd: "4100000000", importUsd: "2200000000" },
  "608": { exportUsd: "5200000000", importUsd: "1800000000" },
  "158": { exportUsd: "4800000000", importUsd: "3600000000" },
  "784": { exportUsd: "2100000000", importUsd: "2500000000" },
  "682": { exportUsd: "1600000000", importUsd: "4300000000" },
};

type Node = { code: string; level: number; parent: string | null; description: string; share: string };

const TREE: Node[] = [
  { code: "TOTAL", level: 0, parent: null, description: "Total seluruh komoditas", share: "1" },
  { code: "09", level: 2, parent: null, description: "Kopi, teh, mate, dan rempah-rempah", share: "0.03" },
  { code: "0901", level: 4, parent: "09", description: "Kopi", share: "0.02" },
  { code: "090111", level: 6, parent: "0901", description: "Kopi, tidak disangrai, tidak dihilangkan kafeinnya", share: "0.012" },
  { code: "090112", level: 6, parent: "0901", description: "Kopi, tidak disangrai, dihilangkan kafeinnya", share: "0.004" },
  { code: "15", level: 2, parent: null, description: "Lemak dan minyak hewani atau nabati", share: "0.18" },
  { code: "1511", level: 4, parent: "15", description: "Minyak kelapa sawit dan fraksinya", share: "0.14" },
  { code: "151110", level: 6, parent: "1511", description: "Minyak kelapa sawit mentah", share: "0.08" },
  { code: "151190", level: 6, parent: "1511", description: "Minyak kelapa sawit dan fraksinya, lainnya", share: "0.05" },
  { code: "15119010", level: 8, parent: "151190", description: "Fraksi minyak kelapa sawit, contoh tarif HS8", share: "0.02" },
  { code: "1513", level: 4, parent: "15", description: "Minyak kelapa, inti kelapa sawit, atau babassu", share: "0.03" },
  { code: "27", level: 2, parent: null, description: "Bahan bakar mineral dan minyak mineral", share: "0.22" },
  { code: "2701", level: 4, parent: "27", description: "Batu bara", share: "0.12" },
  { code: "270112", level: 6, parent: "2701", description: "Batu bara bituminus", share: "0.07" },
  { code: "270119", level: 6, parent: "2701", description: "Batu bara lainnya", share: "0.03" },
  { code: "2709", level: 4, parent: "27", description: "Minyak bumi mentah", share: "0.08" },
  { code: "270900", level: 6, parent: "2709", description: "Minyak bumi mentah", share: "0.07" },
  { code: "40", level: 2, parent: null, description: "Karet dan barang dari karet", share: "0.06" },
  { code: "4001", level: 4, parent: "40", description: "Karet alam", share: "0.045" },
  { code: "400122", level: 6, parent: "4001", description: "Karet alam yang ditentukan secara teknis", share: "0.02" },
  { code: "400129", level: 6, parent: "4001", description: "Karet alam lainnya", share: "0.015" },
  { code: "84", level: 2, parent: null, description: "Reaktor nuklir, ketel, mesin, dan peralatan mekanis", share: "0.08" },
  { code: "8471", level: 4, parent: "84", description: "Mesin pengolah data otomatis", share: "0.04" },
  { code: "847130", level: 6, parent: "8471", description: "Mesin pengolah data portabel", share: "0.015" },
  { code: "847150", level: 6, parent: "8471", description: "Unit pemroses", share: "0.012" },
  { code: "8443", level: 4, parent: "84", description: "Mesin cetak", share: "0.02" },
  { code: "844332", level: 6, parent: "8443", description: "Mesin cetak dan mesin faksimili", share: "0.01" },
  { code: "85", level: 2, parent: null, description: "Mesin dan peralatan listrik", share: "0.09" },
  { code: "8517", level: 4, parent: "85", description: "Perangkat telepon", share: "0.05" },
  { code: "851712", level: 6, parent: "8517", description: "Telepon untuk jaringan seluler", share: "0.02" },
  { code: "851762", level: 6, parent: "8517", description: "Mesin untuk penerimaan dan transmisi data", share: "0.018" },
  { code: "87", level: 2, parent: null, description: "Kendaraan dan bagiannya", share: "0.06" },
  { code: "8703", level: 4, parent: "87", description: "Mobil penumpang", share: "0.04" },
  { code: "870321", level: 6, parent: "8703", description: "Kendaraan dengan mesin tidak lebih dari 1.000 cc", share: "0.01" },
  { code: "870323", level: 6, parent: "8703", description: "Kendaraan dengan mesin 1.500–3.000 cc", share: "0.02" },
];

const HS8_PARTNERS = new Set(["156", "702", "458"]);

function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function scale(base: string, period: string, salt: string): string {
  const year = Number(period.slice(0, 4));
  const growth = new Decimal("1.035").pow(year - 2020);
  const month = period.length === 6 ? Number(period.slice(4)) : null;
  const seasonal = month ? new Decimal(1).div(12).times(new Decimal("0.92").plus((month % 4) * 0.04)) : new Decimal(1);
  const noise = new Decimal("0.97").plus((hash(salt) % 50) / 1000);
  return new Decimal(base).times(growth).times(seasonal).times(noise).toFixed(2);
}

export function buildFixtureObservations(): IncomingObservation[] {
  const periods = allSourcePeriodCodes();
  const rows: IncomingObservation[] = [];
  const names = new Map(bundledPartners().map((partner) => [partner.m49Code, partner.partnerName]));

  for (const partnerCode of FIXTURE_PARTNER_CODES) {
    const base = PARTNER_BASE[partnerCode];
    if (!base) continue;
    for (const periodCode of periods) {
      for (const node of TREE) {
        if (node.level === 8 && !HS8_PARTNERS.has(partnerCode)) continue;
        for (const flow of ["EXPORT", "IMPORT"] as const) {
          const salt = `${partnerCode}|${periodCode}|${node.code}|${flow}`;
          if (node.level === 6 && hash(salt) % 23 === 0) continue;
          const root = flow === "EXPORT" ? base.exportUsd : base.importUsd;
          const amount = node.code === "TOTAL" ? scale(root, periodCode, salt) : scale(new Decimal(root).times(node.share).toFixed(2), periodCode, salt);
          rows.push(observation(partnerCode, names.get(partnerCode) ?? partnerCode, periodCode, node, flow, amount));
        }
      }
    }
  }

  const worldExport = new Map<string, Decimal>();
  const worldImport = new Map<string, Decimal>();
  for (const row of rows) {
    if (row.hsCode !== "TOTAL" || row.tradeValueUsd == null) continue;
    const target = row.flow === "EXPORT" ? worldExport : worldImport;
    target.set(row.periodCode, (target.get(row.periodCode) ?? new Decimal(0)).plus(row.tradeValueUsd));
  }
  for (const periodCode of periods) {
    const exported = worldExport.get(periodCode);
    const imported = worldImport.get(periodCode);
    if (exported) {
      rows.push(observation("0", "World", periodCode, TREE[0], "EXPORT", exported.times("1.07").toFixed(2)));
    }
    if (imported) {
      rows.push(observation("0", "World", periodCode, TREE[0], "IMPORT", imported.times("1.05").toFixed(2)));
    }
  }
  return rows;
}

function observation(
  partnerCode: string,
  partnerName: string,
  periodCode: string,
  node: Node,
  flow: "EXPORT" | "IMPORT",
  tradeValueUsd: string,
): IncomingObservation {
  return {
    reporterCode: REPORTER.code,
    partnerCode,
    partnerName,
    secondPartnerCode: "0",
    periodCode,
    frequency: periodCode.length === 6 ? "MONTHLY" : "ANNUAL",
    year: Number(periodCode.slice(0, 4)),
    month: periodCode.length === 6 ? Number(periodCode.slice(4)) : null,
    flow,
    hsCode: node.code,
    hsLevel: node.level || inferHsLevel(node.code),
    parentCode: node.parent ?? inferParentCode(node.code),
    description: node.description,
    classificationCode: "H6",
    customsCode: "C00",
    transportMode: "0",
    tradeValueUsd,
    quantity: null,
    netWeight: null,
    sourceStatus: "FIXTURE",
    sourceUpdatedAt: "2026-10-17T00:00:00.000Z",
    isReported: true,
    sourceKind: "FIXTURE",
  };
}

let cached: IncomingObservation[] | null = null;

export function fixtureObservations(): IncomingObservation[] {
  cached ??= buildFixtureObservations();
  return cached;
}

export function createFixtureSource(): TradeSource {
  return {
    mode: "fixture",
    async getPartners() {
      return bundledPartners();
    },
    async getAvailability(frequency, periods) {
      return {
        scope: `FIXTURE-DA-${frequency}`,
        payload: {
          note: "Fixture availability. This is not a UN Comtrade publication status.",
          periods,
          partners: FIXTURE_PARTNER_CODES.length,
        },
      };
    },
    async getTariffAvailability(): Promise<TariffAvailability> {
      return {
        supported: true,
        status: "PARTIAL",
        reason: "Fixture includes HS8 only for 15119010 and only for China, Singapore, and Malaysia. This is not official tariff-line coverage.",
      };
    },
    async getTrade(query: TradeQuery) {
      const level = query.cmdCode === "TOTAL" ? 0 : query.hsLevel;
      const partners = new Set(query.partnerCodes);
      const periods = new Set(query.periods);
      const flows = new Set(query.flowCode === "X" ? ["EXPORT"] : query.flowCode === "M" ? ["IMPORT"] : ["EXPORT", "IMPORT"]);
      const selected = fixtureObservations().filter(
        (row) => partners.has(row.partnerCode) && periods.has(row.periodCode) && flows.has(row.flow) && row.hsLevel === level,
      );
      const data = selected.map((row) => ({
        reporterCode: Number(row.reporterCode),
        partnerCode: Number(row.partnerCode),
        partnerDesc: row.partnerName,
        partner2Code: 0,
        period: row.periodCode,
        flowCode: row.flow === "EXPORT" ? "X" : "M",
        cmdCode: row.hsCode,
        cmdDesc: row.description,
        aggrLevel: row.hsLevel,
        customsCode: row.customsCode,
        motCode: Number(row.transportMode),
        primaryValue: row.tradeValueUsd == null ? null : Number(row.tradeValueUsd),
        isReported: true,
        classificationCode: "H6",
      }));
      return normalizeComtradePayload(
        { count: data.length, data, error: null },
        { ...query, maxRecords: 100_000, sourceKind: "FIXTURE" },
      );
    },
  };
}
