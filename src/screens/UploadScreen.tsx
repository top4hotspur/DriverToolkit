import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ImportStatusResponse } from "../contracts/cloudStorage";
import { UploadStatusViewModel } from "../domain/importTypes";
import {
  confirmImportUpload,
  createImportSession,
  getImportStatus,
  uploadZipToS3,
} from "../engines/cloud/importSync";
import { NewAchievementDetectionResult } from "../contracts/newAchievements";
import { detectNewAchievementsAfterImport } from "../presentation/newAchievements";
import { createIdleUploadStatus, uploadStatusCopy } from "../presentation/placeholderUpload";
import { Card, PrimaryButton, ScreenShell } from "./ui";

const DEFAULT_USER_ID = "local-user";

export function UploadScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatusViewModel>(createIdleUploadStatus());
  const [latestSummary, setLatestSummary] = useState<ImportStatusResponse | null>(null);
  const [newAchievements, setNewAchievements] = useState<NewAchievementDetectionResult | null>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeImportId) {
      return;
    }
    let active = true;

    const poll = async () => {
      const response = await getImportStatus({
        userId: DEFAULT_USER_ID,
        importId: activeImportId,
      });
      if (!active || !response.ok || !response.value) {
        return;
      }
      const current = response.value;
      setLatestSummary(current);
      setStatus((previous) => ({
        ...previous,
        phase: current.stage === "failed" ? "error" : current.stage === "completed" ? "success" : "importing",
        title: `Import ${current.stage}`,
        description: `Stage: ${current.stage} (${current.progressPercent}%)`,
      }));

      if (current.stage === "completed") {
        setNewAchievements(detectNewAchievementsAfterImport(current.summary?.matchedTrips ?? 0));
        setActiveImportId(null);
      }
      if (current.stage === "failed") {
        setActiveImportId(null);
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 4_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeImportId]);

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
        description: "Ready to upload your Uber privacy ZIP for backend processing.",
        selectedFileName: asset.name,
        result: null,
      });

      const sessionResult = await createImportSession({
        userId: DEFAULT_USER_ID,
        sourceFileName: asset.name,
        mimeType: asset.mimeType ?? "application/zip",
      });
      if (!sessionResult.ok || !sessionResult.value) {
        throw new Error(sessionResult.error ?? "Could not create backend import session.");
      }

      setStatus({
        phase: "importing",
        title: "Uploading ZIP",
        description: "Uploading your ZIP directly to secure storage...",
        selectedFileName: asset.name,
        result: null,
      });

      const uploadResult = await uploadZipToS3({
        uploadUrl: sessionResult.value.uploadUrl,
        localUri: asset.uri,
        mimeType: asset.mimeType ?? "application/zip",
      });
      if (!uploadResult.ok) {
        throw new Error(uploadResult.error ?? "ZIP upload failed.");
      }

      const confirmResult = await confirmImportUpload({
        userId: DEFAULT_USER_ID,
        importId: sessionResult.value.importId,
      });
      if (!confirmResult.ok) {
        throw new Error(confirmResult.error ?? "Could not start backend processing.");
      }

      setActiveImportId(sessionResult.value.importId);
      setStatus({
        phase: "importing",
        title: "Processing import",
        description: "Upload complete. Backend processing has started.",
        selectedFileName: asset.name,
        result: null,
      });
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
        {latestSummary ? <BackendImportStatusSummary status={latestSummary} /> : null}
        {latestSummary?.stage === "completed" ? (
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
            <Text>{`Import started: ${formatDate(latestSummary.startedAt)}`}</Text>
            <Text>{`Stage: ${latestSummary.stage} (${latestSummary.progressPercent}%)`}</Text>
            {latestSummary.summary?.tripsDateRange ? (
              <Text>
                {`Trip range: ${latestSummary.summary.tripsDateRange.startAt ? formatDate(latestSummary.summary.tripsDateRange.startAt) : "n/a"} to ${latestSummary.summary.tripsDateRange.endAt ? formatDate(latestSummary.summary.tripsDateRange.endAt) : "n/a"}`}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text>No file imported yet.</Text>
        )}
      </Card>
    </ScreenShell>
  );
}

function BackendImportStatusSummary(props: { status: ImportStatusResponse }) {
  const { status } = props;
  const summary = status.summary;

  return (
    <View style={{ marginTop: 8, gap: 4 }}>
      <Text>{status.stage === "completed" ? "Import succeeded." : status.stage === "failed" ? "Import failed." : "Import in progress."}</Text>
      <Text>{`Progress: ${status.progressPercent}%`}</Text>
      {summary ? (
        <View style={{ gap: 2 }}>
          <Text>{`Trips file found: ${summary.tripsFileFound ? "yes" : "no"}`}</Text>
          <Text>{`Payments file found: ${summary.paymentsFileFound ? "yes" : "no"}`}</Text>
          <Text>{`Analytics file found: ${summary.analyticsFileFound ? "yes" : "no"}`}</Text>
          <Text>{`Ignored files: ${summary.ignoredFilesCount}`}</Text>
          <Text>{`Matched payment groups: ${summary.matchedTrips}`}</Text>
          <Text>{`Unmatched trips: ${summary.unmatchedTrips}`}</Text>
          <Text>{`Unmatched payments: ${summary.unmatchedPayments}`}</Text>
          <Text>{`Ambiguous matches: ${summary.ambiguousMatches}`}</Text>
          <Text>{`Reimbursements/adjustments detected: ${formatCurrency(summary.reimbursementsDetected)}`}</Text>
          {summary.analyticsCoverageRange ? (
            <Text>
              {summary.analyticsCoverageRange.startAt && summary.analyticsCoverageRange.endAt
                ? `Analytics coverage: ${formatDate(summary.analyticsCoverageRange.startAt)} to ${formatDate(summary.analyticsCoverageRange.endAt)}`
                : "Analytics coverage: partial or unavailable"}
            </Text>
          ) : (
            <Text>Analytics coverage: not provided</Text>
          )}
          <Text>{`Location-enriched trips: ${summary.locationEnrichedTrips}`}</Text>
        </View>
      ) : null}
      {status.warnings.map((warning, index) => (
        <Text key={`warning-${index}`}>{`Warning: ${warning}`}</Text>
      ))}
      {status.errors.map((error, index) => (
        <Text key={`error-${index}`}>{`Error: ${error}`}</Text>
      ))}
    </View>
  );
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
