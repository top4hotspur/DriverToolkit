export type NormalizedHeaderMap = Record<string, string>;

export function normalizeCsvHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildNormalizedHeaderMap(rawHeaders: string[]): NormalizedHeaderMap {
  const map: NormalizedHeaderMap = {};
  for (const rawHeader of rawHeaders) {
    const normalized = normalizeCsvHeader(rawHeader);
    if (!normalized) {
      continue;
    }
    if (!map[normalized]) {
      map[normalized] = rawHeader;
    }
  }
  return map;
}
