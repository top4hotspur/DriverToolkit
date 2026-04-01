export interface NormalizedUkPostcode {
  rawInput: string;
  normalized: string;
  outwardCode: string | null;
}

export function normalizeUkPostcode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, " ");
}

export function deriveUkOutwardCode(input: string): string | null {
  const normalized = normalizeUkPostcode(input);
  if (!normalized) {
    return null;
  }

  const spaceSplit = normalized.split(" ");
  if (spaceSplit.length > 1 && spaceSplit[0]) {
    return spaceSplit[0];
  }

  const compact = normalized.replace(/\s+/g, "");
  if (compact.length < 2) {
    return null;
  }

  const match = compact.match(/^([A-Z]{1,2}[0-9][A-Z0-9]?)/);
  if (match?.[1]) {
    return match[1];
  }

  return null;
}

export function normalizeUkPostcodeWithOutwardCode(input: string): NormalizedUkPostcode {
  const normalized = normalizeUkPostcode(input);
  return {
    rawInput: input,
    normalized,
    outwardCode: deriveUkOutwardCode(normalized),
  };
}
