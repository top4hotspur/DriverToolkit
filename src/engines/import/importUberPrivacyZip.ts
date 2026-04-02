import { initDatabase } from "../../db/schema";
import { UberTripCandidate, UberTripPaymentMatchRow } from "../../contracts/uberMatching";
import { IntermediateTripRecord, ImportResult } from "../../domain/importTypes";
import { detectProviderFromZip } from "./detectProvider";
import { buildUberTripPaymentMatchingArtifacts, ImportFileDescriptor } from "./adapters";
import { persistImport } from "./importPersistence";
import { normalizeUberTrips } from "./normalizeUberTrip";

export async function importUberPrivacyZip(file: ImportFileDescriptor): Promise<ImportResult> {
  const importedAt = new Date().toISOString();

  try {
    await initDatabase();

    const detection = detectProviderFromZip({
      fileName: file.fileName,
      fileType: file.extension,
      candidateCsvNames: [],
    });

    if (detection.provider !== "uber") {
      return {
        ok: false,
        provider: detection.provider,
        sourceFileName: file.fileName,
        tripCount: 0,
        rawRowCount: 0,
        normalizedRowCount: 0,
        importedAt: null,
        dataStartAt: null,
        dataEndAt: null,
        warnings: [],
        errors: ["Unsupported file: expected Uber privacy ZIP export."],
      };
    }

    const matchArtifacts = await buildUberTripPaymentMatchingArtifacts(file);
    if (!matchArtifacts.validation.ok) {
      return {
        ok: false,
        provider: "uber",
        sourceFileName: file.fileName,
        tripCount: 0,
        rawRowCount: 0,
        normalizedRowCount: 0,
        importedAt: null,
        dataStartAt: null,
        dataEndAt: null,
        warnings: matchArtifacts.validation.warnings,
        errors: [
          matchArtifacts.validation.userFacingError ??
            "Trips and payments files could not be validated for matching.",
        ],
        uberImportSummary: {
          discovery: {
            tripsFileFound: matchArtifacts.discovery.tripsFileFound,
            paymentsFileFound: matchArtifacts.discovery.paymentsFileFound,
            analyticsFileFound: matchArtifacts.discovery.analyticsFileFound,
            ignoredFilesCount: matchArtifacts.discovery.ignoredFilesCount,
          },
          matchedTrips: 0,
          unmatchedTrips: matchArtifacts.unmatchedTrips.length,
          unmatchedPaymentGroups: matchArtifacts.unmatchedPaymentGroups.length,
          ambiguousMatches: matchArtifacts.ambiguousMatches.length,
          reimbursementsDetected: 0,
          analyticsCoverageRange: matchArtifacts.validation.analytics?.range ?? null,
          locationEnrichedTrips: 0,
        },
      };
    }

    const sourceTrips = buildCanonicalTripsFromMatching(matchArtifacts);

    const importId = `import_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const normalized = normalizeUberTrips({
      importId,
      provider: "uber",
      currency: detectImportCurrency(matchArtifacts),
      trips: sourceTrips,
    });

    const sortedDates = sourceTrips
      .map((trip) => trip.startedAt)
      .filter(Boolean)
      .sort();

    const dataStartAt = sortedDates[0] ?? null;
    const dataEndAt = sortedDates[sortedDates.length - 1] ?? null;

    const persisted = await persistImport({
      importId,
      userId: "local-user",
      provider: "uber",
      sourceFileName: file.fileName,
      fileName: file.fileName,
      fileType: "zip",
      fileHash: null,
      fileSignature: buildFileSignature(file),
      parseStatus: "parsed",
      parseNotes:
        matchArtifacts.validation.warnings.length > 0
          ? matchArtifacts.validation.warnings.join(" | ")
          : null,
      importedAt,
      dataStartAt,
      dataEndAt,
      sourceTrips,
      normalized,
      matchingArtifacts: matchArtifacts,
    });

    const reimbursementsDetected = round2(
      matchArtifacts.paymentGroups.reduce((sum, group) => sum + group.totals.reimbursementTotal + group.totals.adjustmentTotal, 0),
    );
    const analyticsCoverageRange = matchArtifacts.validation.analytics?.range ?? null;
    const locationEnrichedTrips = matchArtifacts.analyticsInference.filter(
      (entry) => entry.inferredStart !== null || entry.inferredEnd !== null,
    ).length;

    return {
      ok: true,
      provider: "uber",
      sourceFileName: file.fileName,
      tripCount: sourceTrips.length,
      rawRowCount: persisted.rawRowCount,
      normalizedRowCount: persisted.normalizedRowCount,
      importedAt,
      dataStartAt,
      dataEndAt,
      warnings: [
        ...matchArtifacts.validation.warnings,
        `Trips file found: ${matchArtifacts.discovery.tripsFileFound ? "yes" : "no"}`,
        `Payments file found: ${matchArtifacts.discovery.paymentsFileFound ? "yes" : "no"}`,
        `Analytics file found: ${matchArtifacts.discovery.analyticsFileFound ? "yes" : "no"}`,
        `Ignored files: ${matchArtifacts.discovery.ignoredFilesCount}`,
        `Payment groups matched: ${matchArtifacts.matchedTrips.length}`,
        `Unmatched trips: ${matchArtifacts.unmatchedTrips.length}`,
        `Unmatched payments: ${matchArtifacts.unmatchedPaymentGroups.length}`,
        `Ambiguous matches: ${matchArtifacts.ambiguousMatches.length}`,
      ],
      errors: [],
      uberImportSummary: {
        discovery: {
          tripsFileFound: matchArtifacts.discovery.tripsFileFound,
          paymentsFileFound: matchArtifacts.discovery.paymentsFileFound,
          analyticsFileFound: matchArtifacts.discovery.analyticsFileFound,
          ignoredFilesCount: matchArtifacts.discovery.ignoredFilesCount,
        },
        matchedTrips: matchArtifacts.matchedTrips.length,
        unmatchedTrips: matchArtifacts.unmatchedTrips.length,
        unmatchedPaymentGroups: matchArtifacts.unmatchedPaymentGroups.length,
        ambiguousMatches: matchArtifacts.ambiguousMatches.length,
        reimbursementsDetected,
        analyticsCoverageRange,
        locationEnrichedTrips,
      },
    };
  } catch (error) {
    return {
      ok: false,
      provider: "uber",
      sourceFileName: file.fileName,
      tripCount: 0,
      rawRowCount: 0,
      normalizedRowCount: 0,
      importedAt: null,
      dataStartAt: null,
      dataEndAt: null,
      warnings: [],
      errors: [error instanceof Error ? error.message : "Import failed unexpectedly."],
    };
  }
}

function buildFileSignature(file: ImportFileDescriptor): string {
  const prefix = file.contentsBase64.slice(0, 32);
  return `${file.fileName}:${file.byteLength}:${prefix}`;
}

function buildCanonicalTripsFromMatching(artifacts: {
  tripCandidates: UberTripCandidate[];
  matchedTrips: UberTripPaymentMatchRow[];
  paymentGroups: Array<{ tripUuid: string; totals: { fareIncomeTotal: number; tipTotal: number; airportFeeTotal: number; taxTotal: number; reimbursementTotal: number; adjustmentTotal: number } }>;
}): IntermediateTripRecord[] {
  const groupByUuid = new Map(artifacts.paymentGroups.map((group) => [group.tripUuid, group]));
  const matchByTripId = new Map(artifacts.matchedTrips.map((match) => [match.tripId, match]));

  return artifacts.tripCandidates.map((trip) => {
    const match = matchByTripId.get(trip.tripId);
    const group = match ? groupByUuid.get(match.tripUuid) : undefined;

    const fareGross = group
      ? round2(group.totals.fareIncomeTotal + group.totals.adjustmentTotal + group.totals.reimbursementTotal)
      : round2(trip.originalFareLocal ?? trip.baseFareLocal ?? trip.cancellationFeeLocal ?? 0);
    const tips = round2(group?.totals.tipTotal ?? 0);
    const tolls = round2(group?.totals.airportFeeTotal ?? 0);
    const waits = 0;
    const surgeAmount = 0;

    return {
      externalTripId: trip.tripId,
      providerName: "uber",
      startedAt: trip.beginTripTimestamp ?? trip.requestTimestamp ?? new Date().toISOString(),
      endedAt: trip.dropoffTimestamp ?? trip.beginTripTimestamp ?? trip.requestTimestamp ?? new Date().toISOString(),
      pickupLat: null,
      pickupLng: null,
      dropoffLat: null,
      dropoffLng: null,
      pickupArea: null,
      dropoffArea: null,
      durationMinutes: round2((trip.tripDurationSeconds ?? 0) / 60),
      distanceMiles: round2(trip.tripDistanceMiles ?? 0),
      fareGross,
      surgeAmount,
      tolls,
      waits,
      tips,
      earningsTotal: round2(fareGross + tips + tolls + waits + surgeAmount),
      status: "completed",
      metadata: {
        matchedPaymentGroupUuid: match?.tripUuid ?? null,
        matchingConfidence: match?.score.confidenceBand ?? "NONE",
        matchingScore: match?.score.totalScore ?? 0,
        paymentAnchor: match?.paymentTimestampAnchor ?? null,
        taxTotal: group?.totals.taxTotal ?? 0,
      },
    };
  });
}

function detectImportCurrency(artifacts: {
  validation: { trips: { currencyCodes: string[] }; payments: { currencyCodes: string[] } };
}): string {
  const tripCurrency = artifacts.validation.trips.currencyCodes[0];
  const paymentCurrency = artifacts.validation.payments.currencyCodes[0];
  return tripCurrency ?? paymentCurrency ?? "GBP";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
