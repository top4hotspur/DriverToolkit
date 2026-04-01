import JSZip from "jszip";
import Papa from "papaparse";
import { IntermediateTripRecord } from "../../domain/importTypes";
import { normalizeHeader, safeString, toIsoDateTime, toNumber } from "../../utils/csv";
import { detectProviderFromZip } from "./detectProvider";
import { ImportFileDescriptor, ParsedImportBundle } from "./adapters";

const START_CANDIDATES = ["begintriptime", "starttime", "tripstarttime", "pickupat", "datetimestart"];
const END_CANDIDATES = ["dropofftime", "endtime", "tripendtime", "completedat", "datetimeend"];
const FARE_CANDIDATES = ["faretotal", "total", "totalfare", "yourfare", "faregross", "earnings"];
const DISTANCE_CANDIDATES = ["distancemiles", "tripdistance", "distance", "miles"];
const DURATION_CANDIDATES = ["durationminutes", "duration", "tripduration", "minutes"];
const TRIP_ID_CANDIDATES = ["tripid", "tripuuid", "uuid", "requestid"];
const TIP_CANDIDATES = ["tip", "tips", "tipamount"];
const SURGE_CANDIDATES = ["surge", "surgeamount", "surgepricing"];
const TOLL_CANDIDATES = ["toll", "tolls", "tollamount"];
const WAIT_CANDIDATES = ["waittimeamount", "waittime", "wait"];

export async function parseUberPrivacyZip(file: ImportFileDescriptor): Promise<ParsedImportBundle> {
  if (file.extension !== "zip") {
    throw new Error("Uber import currently requires a ZIP file export.");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file.contentsBase64, { base64: true });
  } catch {
    throw new Error("Selected file is not a valid ZIP archive.");
  }

  const csvEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name);

  const detection = detectProviderFromZip({
    fileName: file.fileName,
    fileType: "zip",
    candidateCsvNames: csvEntries,
  });

  if (detection.provider !== "uber") {
    throw new Error("Could not confirm an Uber privacy export in the selected ZIP.");
  }

  if (csvEntries.length === 0) {
    throw new Error("No CSV files were found inside this ZIP.");
  }

  const warnings: string[] = [];
  const intermediateTrips: IntermediateTripRecord[] = [];
  const assumedColumns = new Set<string>();

  for (const csvName of csvEntries) {
    const fileHandle = zip.file(csvName);
    if (!fileHandle) {
      continue;
    }

    const csvText = await fileHandle.async("string");
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => normalizeHeader(header),
    });

    const fields = parsed.meta.fields ?? [];
    const mapped = mapCsvRowsToIntermediateTrips(parsed.data, fields, csvName, warnings, assumedColumns);
    intermediateTrips.push(...mapped);
  }

  if (intermediateTrips.length === 0) {
    throw new Error("No trip rows could be parsed from detected Uber CSV files.");
  }

  return {
    provider: "uber",
    currency: "GBP",
    detection: {
      ...detection,
      requiredDataFound: true,
    },
    sourceCsvNames: csvEntries,
    assumedColumns: [...assumedColumns],
    intermediateTrips,
    warnings,
  };
}

function mapCsvRowsToIntermediateTrips(
  rows: Array<Record<string, string>>,
  fields: string[],
  sourceCsvName: string,
  warnings: string[],
  assumedColumns: Set<string>,
): IntermediateTripRecord[] {
  const startKey = pickField(fields, START_CANDIDATES);
  const fareKey = pickField(fields, FARE_CANDIDATES);

  if (!startKey || !fareKey) {
    warnings.push(`Skipped ${sourceCsvName}: required columns missing (start time/fare).`);
    return [];
  }

  const endKey = pickField(fields, END_CANDIDATES);
  const distanceKey = pickField(fields, DISTANCE_CANDIDATES);
  const durationKey = pickField(fields, DURATION_CANDIDATES);
  const tripIdKey = pickField(fields, TRIP_ID_CANDIDATES);
  const tipKey = pickField(fields, TIP_CANDIDATES);
  const surgeKey = pickField(fields, SURGE_CANDIDATES);
  const tollKey = pickField(fields, TOLL_CANDIDATES);
  const waitKey = pickField(fields, WAIT_CANDIDATES);
  const pickupAreaKey = pickField(fields, ["pickuplocation", "pickuparea", "pickupaddress", "pickupcity"]);
  const dropoffAreaKey = pickField(fields, ["dropofflocation", "dropoffarea", "dropoffaddress", "dropoffcity"]);
  const pickupLatKey = pickField(fields, ["pickuplatitude", "pickuplat"]);
  const pickupLngKey = pickField(fields, ["pickuplongitude", "pickuplng", "pickuplon"]);
  const dropoffLatKey = pickField(fields, ["dropofflatitude", "dropofflat"]);
  const dropoffLngKey = pickField(fields, ["dropofflongitude", "dropofflng", "dropofflon"]);

  [startKey, fareKey, endKey, distanceKey, durationKey, tripIdKey, tipKey, surgeKey, tollKey, waitKey]
    .filter((key): key is string => Boolean(key))
    .forEach((key) => assumedColumns.add(key));

  const trips: IntermediateTripRecord[] = [];

  rows.forEach((row, index) => {
    const startedAt = toIsoDateTime(row[startKey]);
    const fareGross = toNumber(row[fareKey]);
    if (!startedAt || fareGross === null) {
      return;
    }

    const endedAt = toIsoDateTime(endKey ? row[endKey] : null) ?? startedAt;
    const durationMinutes =
      toNumber(durationKey ? row[durationKey] : null) ??
      Math.max((Date.parse(endedAt) - Date.parse(startedAt)) / 60000, 0);
    const distanceMiles = normalizeMiles(distanceKey ? row[distanceKey] : null);
    const tips = toNumber(tipKey ? row[tipKey] : null) ?? 0;
    const surgeAmount = toNumber(surgeKey ? row[surgeKey] : null) ?? 0;
    const tolls = toNumber(tollKey ? row[tollKey] : null) ?? 0;
    const waits = toNumber(waitKey ? row[waitKey] : null) ?? 0;

    const externalTripId =
      safeString(tripIdKey ? row[tripIdKey] : null) ?? `${sourceCsvName}-row-${index}`;

    trips.push({
      externalTripId,
      providerName: "uber",
      startedAt,
      endedAt,
      pickupLat: toNumber(pickupLatKey ? row[pickupLatKey] : null),
      pickupLng: toNumber(pickupLngKey ? row[pickupLngKey] : null),
      dropoffLat: toNumber(dropoffLatKey ? row[dropoffLatKey] : null),
      dropoffLng: toNumber(dropoffLngKey ? row[dropoffLngKey] : null),
      pickupArea: safeString(pickupAreaKey ? row[pickupAreaKey] : null),
      dropoffArea: safeString(dropoffAreaKey ? row[dropoffAreaKey] : null),
      durationMinutes: round2(Math.max(durationMinutes, 0)),
      distanceMiles: round2(Math.max(distanceMiles ?? 0, 0)),
      fareGross: round2(Math.max(fareGross, 0)),
      surgeAmount: round2(Math.max(surgeAmount, 0)),
      tolls: round2(Math.max(tolls, 0)),
      waits: round2(Math.max(waits, 0)),
      tips: round2(Math.max(tips, 0)),
      earningsTotal: round2(Math.max(fareGross, 0) + Math.max(tips, 0) + Math.max(surgeAmount, 0) + Math.max(tolls, 0) + Math.max(waits, 0)),
      status: "completed",
      metadata: {
        sourceCsvName,
        rowIndex: index,
      },
    });
  });

  return trips;
}

function pickField(fields: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fields.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeMiles(value: unknown): number | null {
  if (typeof value !== "string") {
    return toNumber(value);
  }

  const normalized = value.toLowerCase();
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  if (normalized.includes("km")) {
    return numeric * 0.621371;
  }

  return numeric;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
