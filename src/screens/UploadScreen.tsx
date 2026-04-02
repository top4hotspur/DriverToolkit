import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { initDatabase } from "../db/schema";
import { ImportResult, UploadStatusViewModel } from "../domain/importTypes";
import { ImportFileDescriptor } from "../engines/import/adapters";
import { getLatestImportSummary } from "../engines/import/importPersistence";
import { importUberPrivacyZip } from "../engines/import/importUberPrivacyZip";
import { NewAchievementDetectionResult } from "../contracts/newAchievements";
import { detectNewAchievementsAfterImport } from "../presentation/newAchievements";
import { createIdleUploadStatus, uploadStatusCopy } from "../presentation/placeholderUpload";
import { queuePrivacyImportFileMetadata } from "../state/cloudFileState";
import { Card, PrimaryButton, ScreenShell } from "./ui";

export function UploadScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatusViewModel>(createIdleUploadStatus());
  const [latestSummary, setLatestSummary] = useState<{
    sourceFileName: string;
    importedAt: string;
    recordCount: number;
    dataStartAt: string | null;
    dataEndAt: string | null;
  } | null>(null);
  const [newAchievements, setNewAchievements] = useState<NewAchievementDetectionResult | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadLatest() {
      await initDatabase();
      const summary = await getLatestImportSummary();
      if (!mounted || !summary) {
        return;
      }

      setLatestSummary({
        sourceFileName: summary.sourceFileName,
        importedAt: summary.importedAt,
        recordCount: summary.recordCount,
        dataStartAt: summary.dataStartAt,
        dataEndAt: summary.dataEndAt,
      });
    }

    loadLatest().catch(() => {
      if (!mounted) {
        return;
      }
      setLatestSummary(null);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const onSelectZip = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-zip-compressed"],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled || picked.assets.length === 0) {
        return;
      }

      const asset = picked.assets[0];
      setStatus({
        phase: "selected",
        title: "File selected",
        description: "Ready to import your Uber privacy ZIP locally.",
        selectedFileName: asset.name,
        result: null,
      });

      const fileDescriptor = await toImportFileDescriptor(asset);

      setStatus({
        phase: "importing",
        title: uploadStatusCopy.importingTitle,
        description: uploadStatusCopy.importingDescription,
        selectedFileName: asset.name,
        result: null,
      });

      const result = await importUberPrivacyZip(fileDescriptor);

      setStatus(buildStatusFromResult(asset.name, result));

      if (result.ok && result.importedAt) {
        await queuePrivacyImportFileMetadata({
          provider: "uber",
          sourceFileName: result.sourceFileName,
          localUri: asset.uri,
          fileSizeBytes: asset.size ?? null,
          importedAt: result.importedAt,
        });
        setLatestSummary({
          sourceFileName: result.sourceFileName,
          importedAt: result.importedAt,
          recordCount: result.tripCount,
          dataStartAt: result.dataStartAt,
          dataEndAt: result.dataEndAt,
        });
        setNewAchievements(detectNewAchievementsAfterImport(result.tripCount));
      }
    } catch (error) {
      setStatus({
        phase: "error",
        title: "Import failed",
        description: error instanceof Error ? error.message : "Could not read the selected file.",
        selectedFileName: null,
        result: null,
      });
    }
  };

  return (
    <ScreenShell
      title="Upload"
      subtitle="Your privacy export powers recommendations, reports, and achievements."
    >
      <Card title="Why Upload Matters">
        <Text>Driver Toolkit uses imported historical trips, your local costs, and diary context.</Text>
        <Text>No fake live tracking, and no cloud dependency for personal history.</Text>
      </Card>

      <Card title="How To Get Your Uber File">
        <Text>1. Request your Uber privacy export ZIP.</Text>
        <Text>2. Download it on your phone.</Text>
        <Text>3. Import it here. No manual unzip required.</Text>
      </Card>

      <Card title="Import Uber ZIP">
        <Text>{`Accepted: ${uploadStatusCopy.acceptedFileTypes.join(", ")}`}</Text>
        <PrimaryButton label="Select ZIP and Import" onPress={onSelectZip} />
      </Card>

      <Card title={status.title}>
        <Text>{status.description}</Text>
        {status.selectedFileName ? <Text>{`Selected file: ${status.selectedFileName}`}</Text> : null}
        {status.result ? <ImportResultSummary result={status.result} /> : null}
        {status.result?.ok && status.result.uberImportSummary ? (
          <PrimaryButton label="Review latest import" onPress={() => router.push("/import/review")} />
        ) : null}
      </Card>

      {newAchievements?.hasNewAchievements ? (
        <Card title="New Achievements Since Import">
          {newAchievements.events.map((event, index) => (
            <Text key={`${event.achievementId}-${index}`}>{`${event.headline}: ${event.description}`}</Text>
          ))}
        </Card>
      ) : null}

      <Card title="Latest Imported Dataset">
        {latestSummary ? (
          <View>
            <Text>{`File: ${latestSummary.sourceFileName}`}</Text>
            <Text>{`Imported: ${formatDate(latestSummary.importedAt)}`}</Text>
            <Text>{`Trips: ${latestSummary.recordCount}`}</Text>
            <Text>
              {latestSummary.dataStartAt && latestSummary.dataEndAt
                ? `Date range: ${formatDate(latestSummary.dataStartAt)} to ${formatDate(latestSummary.dataEndAt)}`
                : "Date range: unavailable"}
            </Text>
          </View>
        ) : (
          <Text>No file imported yet.</Text>
        )}
      </Card>
    </ScreenShell>
  );
}

function ImportResultSummary(props: { result: ImportResult }) {
  const { result } = props;

  return (
    <View style={{ marginTop: 8, gap: 4 }}>
      <Text>{result.ok ? "Import succeeded." : "Import failed."}</Text>
      <Text>{`Trips parsed: ${result.tripCount}`}</Text>
      <Text>{`Raw rows: ${result.rawRowCount}`}</Text>
      <Text>{`Normalized rows: ${result.normalizedRowCount}`}</Text>
      {result.dataStartAt && result.dataEndAt ? (
        <Text>{`Data range: ${formatDate(result.dataStartAt)} to ${formatDate(result.dataEndAt)}`}</Text>
      ) : null}
      {result.uberImportSummary ? (
        <View style={{ gap: 2 }}>
          <Text>{`Trips file found: ${result.uberImportSummary.discovery.tripsFileFound ? "yes" : "no"}`}</Text>
          <Text>{`Payments file found: ${result.uberImportSummary.discovery.paymentsFileFound ? "yes" : "no"}`}</Text>
          <Text>{`Analytics file found: ${result.uberImportSummary.discovery.analyticsFileFound ? "yes" : "no"}`}</Text>
          <Text>{`Ignored files: ${result.uberImportSummary.discovery.ignoredFilesCount}`}</Text>
          <Text>{`Matched payment groups: ${result.uberImportSummary.matchedTrips}`}</Text>
          <Text>{`Unmatched trips: ${result.uberImportSummary.unmatchedTrips}`}</Text>
          <Text>{`Unmatched payments: ${result.uberImportSummary.unmatchedPaymentGroups}`}</Text>
          <Text>{`Ambiguous matches: ${result.uberImportSummary.ambiguousMatches}`}</Text>
          <Text>{`Reimbursements/adjustments detected: ${formatCurrency(result.uberImportSummary.reimbursementsDetected)}`}</Text>
          {result.uberImportSummary.analyticsCoverageRange ? (
            <Text>
              {result.uberImportSummary.analyticsCoverageRange.startAt && result.uberImportSummary.analyticsCoverageRange.endAt
                ? `Analytics coverage: ${formatDate(result.uberImportSummary.analyticsCoverageRange.startAt)} to ${formatDate(result.uberImportSummary.analyticsCoverageRange.endAt)}`
                : "Analytics coverage: partial or unavailable"}
            </Text>
          ) : (
            <Text>Analytics coverage: not provided</Text>
          )}
          <Text>{`Location-enriched trips: ${result.uberImportSummary.locationEnrichedTrips}`}</Text>
        </View>
      ) : null}
      {result.warnings.map((warning, index) => (
        <Text key={`warning-${index}`}>{`Warning: ${warning}`}</Text>
      ))}
      {result.errors.map((error, index) => (
        <Text key={`error-${index}`}>{`Error: ${error}`}</Text>
      ))}
    </View>
  );
}

async function toImportFileDescriptor(asset: DocumentPicker.DocumentPickerAsset): Promise<ImportFileDescriptor> {
  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    fileName: asset.name,
    mimeType: asset.mimeType ?? "application/zip",
    extension: "zip",
    byteLength: asset.size ?? base64.length,
    contentsBase64: base64,
  };
}

function buildStatusFromResult(selectedFileName: string, result: ImportResult): UploadStatusViewModel {
  if (result.ok) {
    const summary = result.uberImportSummary;
    const description = summary
      ? `Imported ${result.tripCount} trips, matched ${summary.matchedTrips} payment groups, and left ${summary.unmatchedTrips} unmatched trips for review.`
      : `Imported ${result.tripCount} trips and updated local truth metrics.`;

    return {
      phase: "success",
      title: "Import completed",
      description,
      selectedFileName,
      result,
    };
  }

  return {
    phase: "error",
    title: "Import failed",
    description: "The file could not be imported. Review the message and try another ZIP.",
    selectedFileName,
    result,
  };
}

function formatDate(dateIso: string): string {
  return new Date(dateIso).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
