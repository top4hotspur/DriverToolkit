import JSZip from "jszip";
import Papa from "papaparse";
import {
  UberAmbiguousMatchRow,
  UberMatchCsvFileInput,
  UberMatchEngineInput,
  UberMatchScoreBreakdown,
  UberMatchingValidationResult,
  UberPaymentClassificationTotals,
  UberPaymentGroup,
  UberTripAnalyticsInference,
  UberTripCandidate,
  UberTripPaymentMatchArtifacts,
  UberTripPaymentMatchRow,
  UberUnknownClassificationRow,
  UberUnmatchedPaymentGroupRow,
  UberUnmatchedTripRow,
} from "../../contracts/uberMatching";
import { toIsoDateTime, toNumber } from "../../utils/csv";
import { ImportFileDescriptor } from "./adapters";

type ParsedCsv = {
  fileName: string;
  rows: Array<Record<string, string>>;
  fields: string[];
};

type PaymentScoredCandidate = {
  trip: UberTripCandidate;
  anchorType: "request" | "dropoff" | "begintrip";
  deltaMinutes: number;
  breakdown: UberMatchScoreBreakdown;
};

const DEFAULT_SEARCH_WINDOWS = [10, 20, 30];

const REQUIRED_TRIP_FIELD_GROUPS: Array<{ label: string; candidates: string[] }> = [
  { label: "begin trip timestamp", candidates: ["begin_trip_time", "begintrip_timestamp", "begintriptime", "start_time"] },
  { label: "dropoff timestamp", candidates: ["dropoff_time", "dropoff_timestamp", "dropofftime", "end_time"] },
];
const REQUIRED_PAYMENT_FIELD_GROUPS: Array<{ label: string; candidates: string[] }> = [
  { label: "trip uuid", candidates: ["trip_uuid", "tripuuid", "trip id", "tripid"] },
  { label: "amount", candidates: ["amount", "value", "net_amount", "total"] },
];

const PAYMENT_BUCKETS = {
  fare_income: ["fare", "trip fare", "fare income", "net fare", "delivery fare"],
  tip: ["tip", "tips", "gratuity"],
  commission: ["commission", "service fee", "uber fee", "booking fee"],
  tax: ["tax", "vat", "sales tax"],
  insurance_misc_deduction: ["insurance", "misc deduction", "deduction"],
  airport_fee: ["airport", "city fee", "clean air", "congestion"],
  cash_collected: ["cash collected", "cash", "cash fare"],
  adjustment: ["adjustment", "adjusted", "correction"],
  reimbursement: ["reimbursement", "refund", "repayment"],
  incentive: ["incentive", "bonus", "promotion", "quest"],
} as const;

export async function buildUberTripPaymentArtifactsFromZip(
  file: ImportFileDescriptor,
): Promise<UberTripPaymentMatchArtifacts> {
  if (file.extension !== "zip") {
    throw new Error("Uber matching expects a ZIP export file.");
  }

  const zip = await JSZip.loadAsync(file.contentsBase64, { base64: true });
  const csvEntries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".csv"));
  const csvNames = csvEntries.map((entry) => entry.name);

  const tripsEntry = findCsv(csvNames, ["driver_lifetime_trips-", "driver_lifetime_trips", "lifetime_trips"]);
  const paymentsEntry = findCsv(csvNames, ["driver_payments-", "driver_payments", "payments"]);
  const analyticsEntry = findCsv(csvNames, ["driver_app_analytics-", "driver_app_analytics"]);
  const ignoredFileNames = csvNames.filter(
    (name) => name !== tripsEntry && name !== paymentsEntry && name !== analyticsEntry,
  );

  if (!tripsEntry || !paymentsEntry) {
    throw new Error("Matching requires both trips and payments CSV files in the ZIP.");
  }

  const tripsFile = zip.file(tripsEntry);
  const paymentsFile = zip.file(paymentsEntry);
  const analyticsFile = analyticsEntry ? zip.file(analyticsEntry) : null;

  if (!tripsFile || !paymentsFile) {
    throw new Error("Matching requires both trips and payments CSV files in the ZIP.");
  }

  const [tripsCsv, paymentsCsv, analyticsCsv] = await Promise.all([
    tripsFile.async("string"),
    paymentsFile.async("string"),
    analyticsFile ? analyticsFile.async("string") : Promise.resolve(null),
  ]);

  return buildUberTripPaymentArtifacts({
    tripsFile: { fileName: tripsEntry, csvText: tripsCsv },
    paymentsFile: { fileName: paymentsEntry, csvText: paymentsCsv },
    analyticsFile: analyticsCsv && analyticsEntry ? { fileName: analyticsEntry, csvText: analyticsCsv } : null,
    discovery: {
      tripsFileFound: Boolean(tripsEntry),
      paymentsFileFound: Boolean(paymentsEntry),
      analyticsFileFound: Boolean(analyticsEntry),
      tripsFileName: tripsEntry ?? null,
      paymentsFileName: paymentsEntry ?? null,
      analyticsFileName: analyticsEntry ?? null,
      ignoredFilesCount: ignoredFileNames.length,
      ignoredFileNames,
    },
  });
}

export function buildUberTripPaymentArtifacts(
  input: UberMatchEngineInput & {
    discovery?: UberTripPaymentMatchArtifacts["discovery"];
  },
): UberTripPaymentMatchArtifacts {
  const trips = parseCsv(input.tripsFile);
  const payments = parseCsv(input.paymentsFile);
  const analytics = input.analyticsFile ? parseCsv(input.analyticsFile) : null;

  const tripsCandidates = buildTripCandidates(trips);
  const paymentBuild = buildPaymentGroups(payments);
  const validation = validateMatchingDataset({
    trips,
    tripsCandidates,
    payments,
    paymentGroups: paymentBuild.groups,
    analytics,
  });

  if (!validation.ok) {
    return {
      discovery:
        input.discovery ?? fallbackDiscovery(input, []),
      validation,
      tripCandidates: tripsCandidates,
      paymentGroups: paymentBuild.groups,
      matchedTrips: [],
      unmatchedTrips: tripsCandidates.map((trip) => ({
        tripId: trip.tripId,
        dropoffTimestamp: trip.dropoffTimestamp,
        beginTripTimestamp: trip.beginTripTimestamp,
        originalFareLocal: trip.originalFareLocal,
      })),
      unmatchedPaymentGroups: paymentBuild.groups.map((group) => ({
        tripUuid: group.tripUuid,
        paymentTimestampAnchor: group.paymentTimestampAnchor,
        fareComparable: round2(group.totals.fareIncomeTotal + group.totals.tipTotal),
        tipTotal: group.totals.tipTotal,
        rowCount: group.rawRows.length,
      })),
      ambiguousMatches: [],
      unknownClassification: paymentBuild.unknownRows,
      analyticsInference: [],
    };
  }

  const matchResult = assignTripsToPayments(tripsCandidates, paymentBuild.groups);
  const tripIdSet = new Set(matchResult.matches.map((row) => row.tripId));
  const tripUuidSet = new Set(matchResult.matches.map((row) => row.tripUuid));

  const unmatchedTrips: UberUnmatchedTripRow[] = tripsCandidates
    .filter((trip) => !tripIdSet.has(trip.tripId))
    .map((trip) => ({
      tripId: trip.tripId,
      dropoffTimestamp: trip.dropoffTimestamp,
      beginTripTimestamp: trip.beginTripTimestamp,
      originalFareLocal: trip.originalFareLocal,
    }));

  const unmatchedPaymentGroups: UberUnmatchedPaymentGroupRow[] = paymentBuild.groups
    .filter((group) => !tripUuidSet.has(group.tripUuid))
    .map((group) => ({
      tripUuid: group.tripUuid,
      paymentTimestampAnchor: group.paymentTimestampAnchor,
      fareComparable: round2(group.totals.fareIncomeTotal + group.totals.tipTotal),
      tipTotal: group.totals.tipTotal,
      rowCount: group.rawRows.length,
    }));

  const analyticsInference = buildAnalyticsInference({
    validation,
    analytics,
    trips: tripsCandidates,
  });

  return {
    discovery:
      input.discovery ?? fallbackDiscovery(input, []),
    validation,
    tripCandidates: tripsCandidates,
    paymentGroups: paymentBuild.groups,
    matchedTrips: matchResult.matches,
    unmatchedTrips,
    unmatchedPaymentGroups,
    ambiguousMatches: matchResult.ambiguous,
    unknownClassification: paymentBuild.unknownRows,
    analyticsInference,
  };
}

function fallbackDiscovery(
  input: UberMatchEngineInput,
  ignoredFileNames: string[],
): UberTripPaymentMatchArtifacts["discovery"] {
  return {
    tripsFileFound: true,
    paymentsFileFound: true,
    analyticsFileFound: Boolean(input.analyticsFile),
    tripsFileName: input.tripsFile.fileName,
    paymentsFileName: input.paymentsFile.fileName,
    analyticsFileName: input.analyticsFile?.fileName ?? null,
    ignoredFilesCount: ignoredFileNames.length,
    ignoredFileNames,
  };
}

function parseCsv(file: UberMatchCsvFileInput): ParsedCsv {
  const parsed = Papa.parse<Record<string, string>>(file.csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeUberHeader,
  });

  const fields = (parsed.meta.fields ?? []).filter(Boolean);
  return {
    fileName: file.fileName,
    rows: parsed.data,
    fields,
  };
}

function validateMatchingDataset(args: {
  trips: ParsedCsv;
  tripsCandidates: UberTripCandidate[];
  payments: ParsedCsv;
  paymentGroups: UberPaymentGroup[];
  analytics: ParsedCsv | null;
}): UberMatchingValidationResult {
  const tripsRange = dateRangeFromTrips(args.tripsCandidates.map((trip) => trip.dropoffTimestamp ?? trip.beginTripTimestamp));
  const paymentsRange = dateRangeFromPayments(args.paymentGroups.map((group) => group.paymentTimestampAnchor));
  const analyticsRange = args.analytics
    ? dateRangeFromRows(args.analytics.rows, ["event_timestamp", "timestamp", "recorded_at", "time"])
    : null;

  const tripsCurrencies = collectDistinctValues(args.trips.rows, ["currency_code", "currency", "currencycode"]);
  const paymentsCurrencies = collectDistinctValues(args.payments.rows, ["currency_code", "currency", "currencycode"]);
  const analyticsCurrencies = args.analytics
    ? collectDistinctValues(args.analytics.rows, ["currency_code", "currency", "currencycode"])
    : [];

  const missingTripColumns = missingFieldGroups(args.trips.fields, REQUIRED_TRIP_FIELD_GROUPS);
  const missingPaymentColumns = missingFieldGroups(args.payments.fields, REQUIRED_PAYMENT_FIELD_GROUPS);

  const overlapTripsPayments = rangesOverlap(tripsRange.startAt, tripsRange.endAt, paymentsRange.startAt, paymentsRange.endAt);
  const overlapTripsAnalytics = analyticsRange
    ? rangesOverlap(tripsRange.startAt, tripsRange.endAt, analyticsRange.startAt, analyticsRange.endAt)
    : null;
  const overlapPaymentsAnalytics = analyticsRange
    ? rangesOverlap(paymentsRange.startAt, paymentsRange.endAt, analyticsRange.startAt, analyticsRange.endAt)
    : null;

  const warnings: string[] = [];
  if (overlapTripsAnalytics === false) {
    warnings.push("Analytics file does not overlap trip period; location inference disabled.");
  } else if (
    analyticsRange &&
    tripsRange.startAt &&
    tripsRange.endAt &&
    analyticsRange.startAt &&
    analyticsRange.endAt &&
    (Date.parse(analyticsRange.startAt) > Date.parse(tripsRange.startAt) ||
      Date.parse(analyticsRange.endAt) < Date.parse(tripsRange.endAt))
  ) {
    warnings.push("Analytics coverage is partial; location inference applies to recent overlapping range only.");
  }

  const currencyUnion = new Set([...tripsCurrencies, ...paymentsCurrencies]);
  if (currencyUnion.size > 1) {
    warnings.push("Trips and payments include mixed currencies; review before using financial comparisons.");
  }

  const ok =
    missingTripColumns.length === 0 &&
    missingPaymentColumns.length === 0 &&
    overlapTripsPayments;

  let userFacingError: string | null = null;
  if (!overlapTripsPayments) {
    userFacingError = "Trips and payments files do not overlap in time. Please upload files from the same period.";
  } else if (missingTripColumns.length > 0 || missingPaymentColumns.length > 0) {
    userFacingError = "Required columns are missing in trips or payments file.";
  }

  return {
    ok,
    userFacingError,
    trips: {
      fileName: args.trips.fileName,
      rowCount: args.trips.rows.length,
      currencyCodes: tripsCurrencies,
      range: tripsRange,
      missingRequiredColumns: missingTripColumns,
    },
    payments: {
      fileName: args.payments.fileName,
      rowCount: args.payments.rows.length,
      currencyCodes: paymentsCurrencies,
      range: paymentsRange,
      missingRequiredColumns: missingPaymentColumns,
    },
    analytics: args.analytics
      ? {
          fileName: args.analytics.fileName,
          rowCount: args.analytics.rows.length,
          currencyCodes: analyticsCurrencies,
          range: analyticsRange ?? { startAt: null, endAt: null },
          missingRequiredColumns: [],
        }
      : null,
    overlap: {
      tripsPaymentsOverlap: overlapTripsPayments,
      tripsAnalyticsOverlap: overlapTripsAnalytics,
      paymentsAnalyticsOverlap: overlapPaymentsAnalytics,
    },
    warnings,
  };
}

function buildPaymentGroups(csv: ParsedCsv): {
  groups: UberPaymentGroup[];
  unknownRows: UberUnknownClassificationRow[];
} {
  const tripUuidKey = pickField(csv.fields, ["trip_uuid", "tripuuid", "trip id", "tripid"]);
  const timestampKey = pickField(csv.fields, ["timestamp", "payment_timestamp", "created_at", "transaction_time", "date"]);
  const amountKey = pickField(csv.fields, ["amount", "value", "net_amount", "total"]);
  const classificationKey = pickField(csv.fields, ["classification", "type", "description", "line_item", "payment_type"]);
  const categoryKey = pickField(csv.fields, ["category", "group", "bucket"]);
  const currencyKey = pickField(csv.fields, ["currency_code", "currency", "currencycode"]);

  if (!tripUuidKey || !amountKey) {
    return { groups: [], unknownRows: [] };
  }

  const byTrip = new Map<string, { rows: Array<Record<string, string>>; currencyCode: string | null }>();
  for (const row of csv.rows) {
    const tripUuid = safeTrim(row[tripUuidKey]);
    if (!tripUuid) {
      continue;
    }
    if (!byTrip.has(tripUuid)) {
      byTrip.set(tripUuid, {
        rows: [],
        currencyCode: currencyKey ? safeTrim(row[currencyKey]) : null,
      });
    }
    byTrip.get(tripUuid)?.rows.push(row);
  }

  const groups: UberPaymentGroup[] = [];
  const unknownRows: UberUnknownClassificationRow[] = [];

  for (const [tripUuid, group] of byTrip.entries()) {
    const totals: UberPaymentClassificationTotals = {
      fareIncomeTotal: 0,
      tipTotal: 0,
      commissionTotal: 0,
      taxTotal: 0,
      insuranceMiscDeductionTotal: 0,
      airportFeeTotal: 0,
      cashCollectedTotal: 0,
      adjustmentTotal: 0,
      reimbursementTotal: 0,
      incentiveTotal: 0,
      unclassifiedTotal: 0,
    };

    let paymentAnchor: string | null = null;

    for (const row of group.rows) {
      const amount = toNumber(row[amountKey]);
      if (amount === null) {
        continue;
      }

      const classificationRaw = classificationKey ? safeTrim(row[classificationKey]) : null;
      const categoryRaw = categoryKey ? safeTrim(row[categoryKey]) : null;
      const paymentTimestamp = timestampKey ? toIsoDateTime(row[timestampKey]) : null;
      if (!paymentAnchor && paymentTimestamp) {
        paymentAnchor = paymentTimestamp;
      }

      const bucket = classifyPaymentBucket(classificationRaw, categoryRaw);
      switch (bucket) {
        case "fare_income":
          totals.fareIncomeTotal += amount;
          break;
        case "tip":
          totals.tipTotal += amount;
          break;
        case "commission":
          totals.commissionTotal += amount;
          break;
        case "tax":
          totals.taxTotal += amount;
          break;
        case "insurance_misc_deduction":
          totals.insuranceMiscDeductionTotal += amount;
          break;
        case "airport_fee":
          totals.airportFeeTotal += amount;
          break;
        case "cash_collected":
          totals.cashCollectedTotal += amount;
          break;
        case "adjustment":
          totals.adjustmentTotal += amount;
          break;
        case "reimbursement":
          totals.reimbursementTotal += amount;
          break;
        case "incentive":
          totals.incentiveTotal += amount;
          break;
        default:
          totals.unclassifiedTotal += amount;
          unknownRows.push({
            tripUuid,
            classificationRaw,
            categoryRaw,
            amount,
            paymentTimestamp,
          });
      }
    }

    groups.push({
      tripUuid,
      paymentTimestampAnchor: paymentAnchor,
      currencyCode: group.currencyCode,
      totals: roundTotals(totals),
      rawRows: group.rows,
    });
  }

  return { groups, unknownRows };
}

function buildTripCandidates(csv: ParsedCsv): UberTripCandidate[] {
  const requestKey = pickField(csv.fields, ["request_time", "request_timestamp", "requested_at", "request"]);
  const beginKey = pickField(csv.fields, ["begin_trip_time", "begintrip_timestamp", "begintriptime", "start_time", "begin"]);
  const dropoffKey = pickField(csv.fields, ["dropoff_time", "dropoff_timestamp", "dropofftime", "end_time", "dropoff"]);
  const distanceKey = pickField(csv.fields, ["trip_distance_miles", "distance_miles", "distance", "miles"]);
  const durationKey = pickField(csv.fields, ["trip_duration_seconds", "duration_seconds", "duration", "seconds"]);
  const baseFareKey = pickField(csv.fields, ["base_fare_local", "base_fare", "basefare"]);
  const originalFareKey = pickField(csv.fields, ["original_fare_local", "original_fare", "fare_local", "fare"]);
  const cancellationKey = pickField(csv.fields, ["cancellation_fee_local", "cancellation_fee", "cancel_fee"]);
  const currencyKey = pickField(csv.fields, ["currency_code", "currency", "currencycode"]);
  const vehicleUuidKey = pickField(csv.fields, ["vehicle_uuid", "vehicleid", "vehicle_id"]);
  const plateKey = pickField(csv.fields, ["license_plate", "licence_plate", "plate", "vehicle_plate"]);
  const tripIdKey = pickField(csv.fields, ["trip_id", "tripid", "uuid", "trip_uuid"]);

  return csv.rows.map((row, index) => {
    const beginTripTimestamp = beginKey ? toIsoDateTime(row[beginKey]) : null;
    const dropoffTimestamp = dropoffKey ? toIsoDateTime(row[dropoffKey]) : null;
    return {
      tripId: safeTrim(tripIdKey ? row[tripIdKey] : null) ?? `trip-row-${index}`,
      requestTimestamp: requestKey ? toIsoDateTime(row[requestKey]) : null,
      beginTripTimestamp,
      dropoffTimestamp,
      tripDistanceMiles: distanceKey ? normalizeDistanceMiles(row[distanceKey]) : null,
      tripDurationSeconds: durationKey ? toNumber(row[durationKey]) : null,
      baseFareLocal: baseFareKey ? toNumber(row[baseFareKey]) : null,
      originalFareLocal: originalFareKey ? toNumber(row[originalFareKey]) : null,
      cancellationFeeLocal: cancellationKey ? toNumber(row[cancellationKey]) : null,
      currencyCode: currencyKey ? safeTrim(row[currencyKey]) : null,
      vehicleUuid: vehicleUuidKey ? safeTrim(row[vehicleUuidKey]) : null,
      licensePlate: plateKey ? safeTrim(row[plateKey]) : null,
      sourceRow: row,
    };
  });
}

function assignTripsToPayments(
  trips: UberTripCandidate[],
  paymentGroups: UberPaymentGroup[],
): {
  matches: UberTripPaymentMatchRow[];
  ambiguous: UberAmbiguousMatchRow[];
} {
  const usedTripIds = new Set<string>();
  const matches: UberTripPaymentMatchRow[] = [];
  const ambiguous: UberAmbiguousMatchRow[] = [];

  const orderedGroups = [...paymentGroups].sort((a, b) => {
    const aTime = a.paymentTimestampAnchor ? Date.parse(a.paymentTimestampAnchor) : Number.MAX_SAFE_INTEGER;
    const bTime = b.paymentTimestampAnchor ? Date.parse(b.paymentTimestampAnchor) : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  for (const group of orderedGroups) {
    const candidates = scoreCandidatesForPaymentGroup(group, trips.filter((trip) => !usedTripIds.has(trip.tripId)));
    if (candidates.length === 0) {
      continue;
    }

    const best = candidates[0];
    const second = candidates[1];

    if (second && Math.abs(best.breakdown.totalScore - second.breakdown.totalScore) < 0.08) {
      ambiguous.push({
        tripUuid: group.tripUuid,
        topCandidateTripId: best.trip.tripId,
        secondCandidateTripId: second.trip.tripId,
        topScore: best.breakdown.totalScore,
        secondScore: second.breakdown.totalScore,
        scoreDelta: Math.abs(best.breakdown.totalScore - second.breakdown.totalScore),
      });
    }

    usedTripIds.add(best.trip.tripId);
    matches.push({
      tripId: best.trip.tripId,
      tripUuid: group.tripUuid,
      matchedBy: best.anchorType,
      score: best.breakdown,
      matchedAt:
        best.anchorType === "request"
          ? best.trip.requestTimestamp
          : best.anchorType === "dropoff"
            ? best.trip.dropoffTimestamp
            : best.trip.beginTripTimestamp,
      tripDropoffTimestamp: best.trip.dropoffTimestamp,
      tripBeginTimestamp: best.trip.beginTripTimestamp,
      paymentTimestampAnchor: group.paymentTimestampAnchor,
      tripFareComparable: comparableTripFare(best.trip),
      paymentFareComparable: comparablePaymentFare(group),
      deltaMinutes: best.deltaMinutes,
      deltaFare: comparableTripFare(best.trip) === null
        ? null
        : round2(Math.abs((comparableTripFare(best.trip) ?? 0) - comparablePaymentFare(group))),
    });
  }

  return { matches, ambiguous };
}

function scoreCandidatesForPaymentGroup(
  group: UberPaymentGroup,
  trips: UberTripCandidate[],
): PaymentScoredCandidate[] {
  if (!group.paymentTimestampAnchor) {
    return [];
  }

  const paymentAt = Date.parse(group.paymentTimestampAnchor);
  if (Number.isNaN(paymentAt)) {
    return [];
  }

  for (const windowMinutes of DEFAULT_SEARCH_WINDOWS) {
    const scoped = trips
      .map((trip) => {
        const requestDelta = minutesDelta(paymentAt, trip.requestTimestamp);
        const dropoffDelta = minutesDelta(paymentAt, trip.dropoffTimestamp);
        const beginDelta = minutesDelta(paymentAt, trip.beginTripTimestamp);

        const candidates: Array<{ anchorType: "request" | "dropoff" | "begintrip"; delta: number | null; priority: number }> = [
          { anchorType: "request", delta: requestDelta, priority: 1 },
          { anchorType: "dropoff", delta: dropoffDelta, priority: 2 },
          { anchorType: "begintrip", delta: beginDelta, priority: 3 },
        ];

        const bestAnchor = candidates
          .filter((candidate): candidate is { anchorType: "request" | "dropoff" | "begintrip"; delta: number; priority: number } => candidate.delta !== null)
          .sort((a, b) => {
            if (a.delta === b.delta) {
              return a.priority - b.priority;
            }
            return a.delta - b.delta;
          })[0];

        if (!bestAnchor || bestAnchor.delta > windowMinutes) {
          return null;
        }

        const breakdown = buildScoreBreakdown({
          trip,
          paymentGroup: group,
          deltaMinutes: bestAnchor.delta,
          candidateCountHint: trips.length,
          searchWindowMinutes: windowMinutes,
        });

        return {
          trip,
          anchorType: bestAnchor.anchorType,
          deltaMinutes: bestAnchor.delta,
          breakdown,
        };
      })
      .filter((value): value is PaymentScoredCandidate => value !== null)
      .sort((a, b) => b.breakdown.totalScore - a.breakdown.totalScore);

    if (scoped.length > 0) {
      return scoped;
    }
  }

  return [];
}

function buildScoreBreakdown(args: {
  trip: UberTripCandidate;
  paymentGroup: UberPaymentGroup;
  deltaMinutes: number;
  candidateCountHint: number;
  searchWindowMinutes: number;
}): UberMatchScoreBreakdown {
  const timeProximityScore = clamp01(1 - args.deltaMinutes / Math.max(args.searchWindowMinutes, 1));

  const tripFare = comparableTripFare(args.trip);
  const paymentFare = comparablePaymentFare(args.paymentGroup);
  const fareSimilarityScore =
    tripFare === null || paymentFare <= 0
      ? 0.5
      : clamp01(1 - Math.abs(tripFare - paymentFare) / Math.max(paymentFare, 1));

  const uniquenessScore = clamp01(1 / Math.max(args.candidateCountHint, 1));

  const totalScore = round2(
    timeProximityScore * 0.5 +
      fareSimilarityScore * 0.35 +
      uniquenessScore * 0.15,
  );

  return {
    timeProximityScore: round2(timeProximityScore),
    fareSimilarityScore: round2(fareSimilarityScore),
    uniquenessScore: round2(uniquenessScore),
    totalScore,
    confidenceBand: confidenceBand(totalScore),
    searchWindowMinutes: args.searchWindowMinutes,
  };
}

function buildAnalyticsInference(args: {
  validation: UberMatchingValidationResult;
  analytics: ParsedCsv | null;
  trips: UberTripCandidate[];
}): UberTripAnalyticsInference[] {
  if (!args.analytics || args.validation.overlap.tripsAnalyticsOverlap === false) {
    return [];
  }

  const timestampKey = pickField(args.analytics.fields, ["event_timestamp", "timestamp", "recorded_at", "time"]);
  const latKey = pickField(args.analytics.fields, ["latitude", "lat", "start_lat", "end_lat"]);
  const lngKey = pickField(args.analytics.fields, ["longitude", "lng", "lon", "start_lng", "end_lng"]);

  if (!timestampKey || !latKey || !lngKey) {
    return [];
  }

  const points = args.analytics.rows
    .map((row) => {
      const timestamp = toIsoDateTime(row[timestampKey]);
      const latitude = toNumber(row[latKey]);
      const longitude = toNumber(row[lngKey]);
      if (!timestamp || latitude === null || longitude === null) {
        return null;
      }
      return { timestamp, latitude, longitude };
    })
    .filter((point): point is { timestamp: string; latitude: number; longitude: number } => point !== null)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  if (points.length === 0) {
    return [];
  }

  return args.trips.map((trip) => ({
    tripId: trip.tripId,
    inferredStart: nearestAnalyticsPoint(points, trip.beginTripTimestamp),
    inferredEnd: nearestAnalyticsPoint(points, trip.dropoffTimestamp),
  }));
}

function nearestAnalyticsPoint(
  points: Array<{ timestamp: string; latitude: number; longitude: number }>,
  tripTimestamp: string | null,
): { latitude: number; longitude: number; timestamp: string; confidence: number } | null {
  if (!tripTimestamp) {
    return null;
  }

  const target = Date.parse(tripTimestamp);
  if (Number.isNaN(target)) {
    return null;
  }

  let best: { timestamp: string; latitude: number; longitude: number; deltaSeconds: number } | null = null;
  for (const point of points) {
    const deltaSeconds = Math.abs(Date.parse(point.timestamp) - target) / 1000;
    if (best === null || deltaSeconds < best.deltaSeconds) {
      best = { ...point, deltaSeconds };
    }
  }

  if (!best) {
    return null;
  }

  const confidence = clamp01(1 - best.deltaSeconds / 300);
  return {
    latitude: best.latitude,
    longitude: best.longitude,
    timestamp: best.timestamp,
    confidence: round2(confidence),
  };
}

function classifyPaymentBucket(
  classificationRaw: string | null,
  categoryRaw: string | null,
): keyof typeof PAYMENT_BUCKETS | "unknown" {
  const classification = (classificationRaw ?? "").toLowerCase();
  const category = (categoryRaw ?? "").toLowerCase();

  const combined = `${classification} ${category}`;

  for (const [bucket, terms] of Object.entries(PAYMENT_BUCKETS) as Array<[
    keyof typeof PAYMENT_BUCKETS,
    readonly string[],
  ]>) {
    if (terms.some((term) => combined.includes(term))) {
      return bucket;
    }
  }

  return "unknown";
}

function comparableTripFare(trip: UberTripCandidate): number | null {
  if (trip.originalFareLocal !== null) {
    return round2(trip.originalFareLocal);
  }
  if (trip.baseFareLocal !== null) {
    return round2(trip.baseFareLocal);
  }
  if (trip.cancellationFeeLocal !== null) {
    return round2(trip.cancellationFeeLocal);
  }
  return null;
}

function comparablePaymentFare(group: UberPaymentGroup): number {
  return round2(group.totals.fareIncomeTotal + group.totals.tipTotal + group.totals.adjustmentTotal + group.totals.reimbursementTotal);
}

function dateRangeFromTrips(values: Array<string | null>): { startAt: string | null; endAt: string | null } {
  return dateRangeFromIso(values);
}

function dateRangeFromPayments(values: Array<string | null>): { startAt: string | null; endAt: string | null } {
  return dateRangeFromIso(values);
}

function dateRangeFromRows(rows: Array<Record<string, string>>, candidates: string[]): { startAt: string | null; endAt: string | null } {
  const keys = Object.keys(rows[0] ?? {});
  const key = pickField(keys, candidates);
  if (!key) {
    return { startAt: null, endAt: null };
  }
  return dateRangeFromIso(rows.map((row) => toIsoDateTime(row[key])));
}

function dateRangeFromIso(values: Array<string | null>): { startAt: string | null; endAt: string | null } {
  const valid = values.filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    startAt: valid[0] ?? null,
    endAt: valid[valid.length - 1] ?? null,
  };
}

function rangesOverlap(
  leftStart: string | null,
  leftEnd: string | null,
  rightStart: string | null,
  rightEnd: string | null,
): boolean {
  if (!leftStart || !leftEnd || !rightStart || !rightEnd) {
    return false;
  }
  return Date.parse(leftStart) <= Date.parse(rightEnd) && Date.parse(rightStart) <= Date.parse(leftEnd);
}

function missingFieldGroups(
  fields: string[],
  groups: Array<{ label: string; candidates: string[] }>,
): string[] {
  const missing: string[] = [];
  for (const group of groups) {
    if (!pickField(fields, group.candidates)) {
      missing.push(group.label);
    }
  }
  return missing;
}

function collectDistinctValues(rows: Array<Record<string, string>>, keys: string[]): string[] {
  const firstRow = rows[0];
  if (!firstRow) {
    return [];
  }

  const headerKey = pickField(Object.keys(firstRow), keys);
  if (!headerKey) {
    return [];
  }

  const values = new Set<string>();
  for (const row of rows) {
    const value = safeTrim(row[headerKey]);
    if (value) {
      values.add(value.toUpperCase());
    }
  }
  return [...values].sort();
}

function pickField(fields: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fields.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findCsv(csvNames: string[], candidates: string[]): string | null {
  const lowerNames = csvNames.map((name) => ({
    original: name,
    normalized: name.toLowerCase(),
  }));

  for (const candidate of candidates) {
    const match = lowerNames.find((entry) => entry.normalized.includes(candidate));
    if (match) {
      return match.original;
    }
  }

  return null;
}

function normalizeUberHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function safeTrim(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDistanceMiles(value: unknown): number | null {
  if (typeof value !== "string") {
    return toNumber(value);
  }

  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  if (value.toLowerCase().includes("km")) {
    return round2(numeric * 0.621371);
  }

  return round2(numeric);
}

function minutesDelta(anchorMillis: number, candidateIso: string | null): number | null {
  if (!candidateIso) {
    return null;
  }
  const millis = Date.parse(candidateIso);
  if (Number.isNaN(millis)) {
    return null;
  }
  return Math.abs(anchorMillis - millis) / 60000;
}

function confidenceBand(totalScore: number): "HIGH" | "MEDIUM" | "LOW" | "NONE" {
  if (totalScore >= 0.78) {
    return "HIGH";
  }
  if (totalScore >= 0.58) {
    return "MEDIUM";
  }
  if (totalScore > 0) {
    return "LOW";
  }
  return "NONE";
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundTotals(totals: UberPaymentClassificationTotals): UberPaymentClassificationTotals {
  return {
    fareIncomeTotal: round2(totals.fareIncomeTotal),
    tipTotal: round2(totals.tipTotal),
    commissionTotal: round2(totals.commissionTotal),
    taxTotal: round2(totals.taxTotal),
    insuranceMiscDeductionTotal: round2(totals.insuranceMiscDeductionTotal),
    airportFeeTotal: round2(totals.airportFeeTotal),
    cashCollectedTotal: round2(totals.cashCollectedTotal),
    adjustmentTotal: round2(totals.adjustmentTotal),
    reimbursementTotal: round2(totals.reimbursementTotal),
    incentiveTotal: round2(totals.incentiveTotal),
    unclassifiedTotal: round2(totals.unclassifiedTotal),
  };
}
