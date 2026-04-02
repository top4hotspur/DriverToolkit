import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ImportStatusResponse } from "../contracts/cloudStorage";
import { initDatabase } from "../db/schema";
import { getLatestUberImportReview, LatestUberImportReview } from "../engines/import/importPersistence";
import { getLatestCompletedImportStatus } from "../state/importStatusState";
import { formatGBP, formatUkDate, formatUkDateTime } from "../utils/format";
import { Card, KeyValueRow, ScreenShell } from "./ui";

export function UberImportReviewScreen() {
  const [review, setReview] = useState<LatestUberImportReview | null>(null);
  const [backendStatusReview, setBackendStatusReview] = useState<ImportStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        await initDatabase();
        const latest = await getLatestUberImportReview();
        if (!active) {
          return;
        }
        setReview(latest);
        if (!latest) {
          const persisted = await getLatestCompletedImportStatus();
          if (!active) {
            return;
          }
          setBackendStatusReview(persisted);
        } else {
          setBackendStatusReview(null);
        }
        setError(null);
      } catch {
        if (!active) {
          return;
        }
        setError("Couldn't load the latest import review right now.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ScreenShell
      title="Uber Import Review"
      subtitle="Review the latest import quality, matching health, and follow-up actions."
    >
      {loading ? <Text>Loading latest import review...</Text> : null}
      {error ? <Text style={{ color: "#7a382f" }}>{error}</Text> : null}

      {!loading && !review ? (
        <Card title="No Import Review Yet">
          {backendStatusReview ? (
            <View style={{ gap: 4 }}>
              <Text>Showing latest backend import summary.</Text>
              <KeyValueRow label="Import ID" value={backendStatusReview.importId} />
              <KeyValueRow label="Status" value={backendStatusReview.stage} />
              <KeyValueRow label="Source file" value={backendStatusReview.sourceFileName} />
              <KeyValueRow label="Started" value={formatUkDateTime(backendStatusReview.startedAt)} />
              <KeyValueRow
                label="Matched trips/payment groups"
                value={String(backendStatusReview.summary?.matchedTrips ?? 0)}
              />
              <KeyValueRow label="Unmatched trips" value={String(backendStatusReview.summary?.unmatchedTrips ?? 0)} />
              <KeyValueRow
                label="Unmatched payments"
                value={String(backendStatusReview.summary?.unmatchedPayments ?? 0)}
              />
              <KeyValueRow label="Ambiguous matches" value={String(backendStatusReview.summary?.ambiguousMatches ?? 0)} />
            </View>
          ) : (
            <Text>Import an Uber ZIP first, then review matching quality here.</Text>
          )}
        </Card>
      ) : null}

      {review ? (
        <>
          <Card title="Import Snapshot">
            <KeyValueRow label="Imported" value={formatUkDateTime(review.importedAt)} />
            <KeyValueRow label="Source file" value={review.sourceFileName} />
            <KeyValueRow label="Import status" value={review.parseStatus === "parsed" ? "Import succeeded" : "Import failed"} />
            <KeyValueRow label="Trips file found" value={toYesNo(review.discovery.tripsFileFound)} />
            <KeyValueRow label="Payments file found" value={toYesNo(review.discovery.paymentsFileFound)} />
            <KeyValueRow label="Analytics file found" value={toYesNo(review.discovery.analyticsFileFound)} />
            <KeyValueRow label="Ignored files" value={String(review.discovery.ignoredFilesCount)} />
            <KeyValueRow label="Trips date range" value={formatRange(review.tripsDateRange.startAt, review.tripsDateRange.endAt)} />
            <KeyValueRow label="Payments date range" value={formatRange(review.paymentsDateRange.startAt, review.paymentsDateRange.endAt)} />
            <KeyValueRow
              label="Analytics date range"
              value={review.analyticsDateRange ? formatRange(review.analyticsDateRange.startAt, review.analyticsDateRange.endAt) : "Not provided"}
            />
          </Card>

          <Card title="Matching Summary">
            <KeyValueRow label="Matched trips / payment groups" value={String(review.matchedTrips)} />
            <KeyValueRow label="Unmatched trips" value={String(review.unmatchedTrips)} />
            <KeyValueRow label="Unmatched payments" value={String(review.unmatchedPaymentGroups)} />
            <KeyValueRow label="Ambiguous matches" value={String(review.ambiguousMatches)} />
            <KeyValueRow label="Reimbursements/adjustments" value={formatGBP(review.reimbursementsDetected)} />
            <KeyValueRow label="Location-enriched trips" value={String(review.locationEnrichedTrips)} />
            <Text>{`Analytics coverage: ${review.analyticsCoverageNote}`}</Text>
            <Text>{followUpMessage(review)}</Text>
          </Card>

          <Card title="Matched Trip Examples">
            {review.matchedExamples.length === 0 ? (
              <Text>No matched examples available.</Text>
            ) : (
              review.matchedExamples.map((item) => (
                <View key={`${item.tripId}-${item.tripUuid}`} style={{ marginBottom: 8 }}>
                  <Text>{`Trip ${item.tripId} <-> ${item.tripUuid}`}</Text>
                  <Text>{`Confidence: ${item.confidenceBand} (${item.score.toFixed(2)})`}</Text>
                  <Text>{`Matched at: ${item.matchedAt ? formatUkDateTime(item.matchedAt) : "Unknown"}`}</Text>
                </View>
              ))
            )}
          </Card>

          <Card title="Unmatched Trip Examples">
            {review.unmatchedTripExamples.length === 0 ? (
              <Text>No unmatched trips in latest import.</Text>
            ) : (
              review.unmatchedTripExamples.map((item) => (
                <View key={item.tripId} style={{ marginBottom: 8 }}>
                  <Text>{`Trip ${item.tripId}`}</Text>
                  <Text>{`Dropoff: ${item.dropoffTimestamp ? formatUkDateTime(item.dropoffTimestamp) : "Unknown"}`}</Text>
                  <Text>{`Fare marker: ${item.originalFareLocal === null ? "Unknown" : formatGBP(item.originalFareLocal)}`}</Text>
                </View>
              ))
            )}
          </Card>

          <Card title="Unmatched Payment Examples">
            {review.unmatchedPaymentExamples.length === 0 ? (
              <Text>No unmatched payment groups in latest import.</Text>
            ) : (
              review.unmatchedPaymentExamples.map((item) => (
                <View key={item.tripUuid} style={{ marginBottom: 8 }}>
                  <Text>{`Trip UUID ${item.tripUuid}`}</Text>
                  <Text>{`Payment anchor: ${item.paymentTimestampAnchor ? formatUkDateTime(item.paymentTimestampAnchor) : "Unknown"}`}</Text>
                  <Text>{`Fare comparable: ${formatGBP(item.fareComparable)}`}</Text>
                </View>
              ))
            )}
          </Card>

          <Card title="Reimbursement / Adjustment Examples">
            {review.reimbursementExamples.length === 0 ? (
              <Text>No reimbursements or adjustments detected in this import.</Text>
            ) : (
              review.reimbursementExamples.map((item) => (
                <View key={item.tripUuid} style={{ marginBottom: 8 }}>
                  <Text>{`Trip UUID ${item.tripUuid}`}</Text>
                  <Text>{`Reimbursement: ${formatGBP(item.reimbursementTotal)}`}</Text>
                  <Text>{`Adjustment: ${formatGBP(item.adjustmentTotal)}`}</Text>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </ScreenShell>
  );
}

function toYesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function formatRange(startAt: string | null, endAt: string | null): string {
  if (!startAt || !endAt) {
    return "Unavailable";
  }
  return `${formatUkDate(startAt)} to ${formatUkDate(endAt)}`;
}

function followUpMessage(review: LatestUberImportReview): string {
  if (review.unmatchedTrips === 0 && review.unmatchedPaymentGroups === 0 && review.ambiguousMatches === 0) {
    return "Matching quality looks strong. No immediate follow-up needed.";
  }
  if (review.unmatchedTrips > 0 || review.unmatchedPaymentGroups > 0) {
    return "Follow-up suggested: review unmatched trips/payments before relying on this period for deeper analysis.";
  }
  return "Some matches are ambiguous. Keep this in mind when reviewing this import period.";
}
