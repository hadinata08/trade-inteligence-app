import type { PartnerEntityType } from "@prisma/client";
import bundled from "./reference/partners.json";

type BundledPartner = {
  m49: string;
  name: string;
  iso2: string | null;
  iso3: string | null;
  group: boolean;
};

const AGGREGATE_NAME =
  /,\s*nes\b|^World$|^Bunkers$|^Free Zones$|^Special Categories$|^Neutral Zone$|^Areas, nes$|Canal Zone/i;

const TERRITORY_NAME =
  /Island|Isds|Islands|Is\.|SAR|Taiwan|Polynesia|Greenland|Faroe|Aruba|Cura[cç]ao|Martinique|Guadeloupe|Mayotte|R[eé]union|Caledonia|Bermuda|Gibraltar|Antarctic|Terr\.|Saint |St\. |Virgin|Samoa|Guam|Jersey|Guernsey|Isle of Man|Montserrat|Anguilla|Tokelau|Niue|Pitcairn|Wallis|Futuna|Faeroe|Kosovo/i;

export function classifyEntity(input: { m49: string; name: string; group: boolean }): PartnerEntityType {
  if (input.group || input.m49 === "0" || AGGREGATE_NAME.test(input.name)) return "AGGREGATE";
  if (TERRITORY_NAME.test(input.name)) return "TERRITORY";
  return "COUNTRY";
}

export function bundledPartners(): Array<{
  m49Code: string;
  partnerName: string;
  iso2: string | null;
  iso3: string | null;
  entityType: PartnerEntityType;
}> {
  return (bundled as BundledPartner[]).map((partner) => ({
    m49Code: String(partner.m49),
    partnerName: partner.name.trim(),
    iso2: partner.iso2?.trim() || null,
    iso3: partner.iso3?.trim() || null,
    entityType: classifyEntity({ m49: String(partner.m49), name: partner.name, group: partner.group }),
  }));
}

export function parsePartnerReference(payload: unknown): ReturnType<typeof bundledPartners> {
  const results = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results
      : [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const code = row.PartnerCode ?? row.partnerCode ?? row.id;
    const name = String(row.PartnerDesc ?? row.text ?? "").trim();
    if (code == null || !name) return [];
    const m49 = String(code);
    const group = Boolean(row.isGroup);
    return [
      {
        m49Code: m49,
        partnerName: name,
        iso2: String(row.PartnerCodeIsoAlpha2 ?? row.iso2 ?? "").trim() || null,
        iso3: String(row.PartnerCodeIsoAlpha3 ?? row.iso3 ?? "").trim() || null,
        entityType: classifyEntity({ m49, name, group }),
      },
    ];
  });
}
