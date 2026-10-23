export type HierarchyNode = {
  hsCode: string;
  level: number;
  parentCode: string | null;
};

export function inferParentCode(hsCode: string): string | null {
  if (!hsCode || hsCode === "TOTAL") return null;
  if (hsCode.length <= 2) return null;
  if (hsCode.length <= 4) return hsCode.slice(0, 2);
  if (hsCode.length <= 6) return hsCode.slice(0, 4);
  return hsCode.slice(0, 6);
}

export function inferHsLevel(hsCode: string): number {
  if (hsCode === "TOTAL") return 0;
  if (hsCode.length <= 2) return 2;
  if (hsCode.length <= 4) return 4;
  if (hsCode.length <= 6) return 6;
  return 8;
}

/**
 * Preorder walk of the HS parent-child tree.
 * Children of a code are emitted before the next sibling, which is not the
 * same as sorting by level and then by code.
 */
export function orderHierarchically<T extends HierarchyNode>(rows: T[]): T[] {
  const byParent = new Map<string, T[]>();
  const byCode = new Map<string, T>();
  for (const row of rows) {
    if (!byCode.has(row.hsCode)) byCode.set(row.hsCode, row);
    const key = row.parentCode ?? "";
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.hsCode.localeCompare(b.hsCode, "en"));
  }

  const ordered: T[] = [];
  const seen = new Set<string>();

  const walk = (parent: string) => {
    const children = byParent.get(parent) ?? [];
    for (const child of children) {
      if (seen.has(child.hsCode)) continue;
      seen.add(child.hsCode);
      ordered.push(child);
      walk(child.hsCode);
    }
  };

  walk("");

  const orphans = rows
    .filter((row) => !seen.has(row.hsCode))
    .sort((a, b) => a.hsCode.localeCompare(b.hsCode, "en"));
  for (const orphan of orphans) {
    if (seen.has(orphan.hsCode)) continue;
    seen.add(orphan.hsCode);
    ordered.push(orphan);
    walk(orphan.hsCode);
  }

  return ordered;
}

/** Excel outline level: period section is 0, TOTAL/HS2 start at 1, each child steps down. */
export function outlineLevelFor(level: number): number {
  if (level <= 0) return 1;
  if (level === 2) return 2;
  if (level === 4) return 3;
  if (level === 6) return 4;
  return 5;
}
