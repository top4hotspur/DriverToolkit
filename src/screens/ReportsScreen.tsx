import { Link, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { getReportRoute } from "../contracts/reportRegistry";
import {
  placeholderReportCards,
  placeholderReportsAdminSection,
  placeholderReportsUploadStatus,
} from "../presentation/placeholderReports";
import { evidenceDetailFromSample, evidenceLabelFromConfidence, formatGBP } from "../utils/format";
import { Card, ConfidenceBadge, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

export function ReportsScreen() {
  const router = useRouter();

  return (
    <ScreenShell
      title="Reports"
      subtitle="Intelligence hub for decision support from historical evidence."
      footerCta={<PrimaryButton label="Upload New Export" onPress={() => router.push("/upload")} />}
    >
      <Card title="Upload / Sync Status" compact>
        <Text>{placeholderReportsUploadStatus.title}</Text>
        <Text>{placeholderReportsUploadStatus.subtitle}</Text>
      </Card>

      {placeholderReportCards.map((report) => {
        const reportRoute = getReportRoute(report.type);

        return (
          <Link
            href={
              reportRoute === "/reports/achievements"
                ? "/reports/achievements"
                : {
                    pathname: "/reports/detail/[reportId]",
                    params: { reportId: report.type },
                  }
            }
            asChild
            key={report.type}
          >
            <View>
              <Card title={report.title}>
                <Text>{report.summary}</Text>
                <Text>{report.insightNudge}</Text>
                <KeyValueRow label="Basis" value={report.basisWindow.label} />
                <ConfidenceBadge
                  evidenceLabel={evidenceLabelFromConfidence(report.confidence)}
                  evidenceDetail={evidenceDetailFromSample(report.sampleSize, "comparable periods")}
                />
              </Card>
            </View>
          </Link>
        );
      })}

      <Card title="Admin / Record-Keeping">
        <Text>{placeholderReportsAdminSection.adminSummary}</Text>
        <Text>{`Receipt inputs: ${placeholderReportsAdminSection.receiptInputModes.join(" + ")}`}</Text>
        {placeholderReportsAdminSection.records.map((record) => (
          <View key={record.id} style={{ marginTop: 8 }}>
            <Text>{`${record.title} (${record.syncState})`}</Text>
            <Text>{record.amount !== null ? formatGBP(record.amount) : "No amount"}</Text>
            {record.receipt ? (
              <Text>{`Receipt: ${record.receipt.receiptSourceType} - ${record.receipt.mimeType}`}</Text>
            ) : (
              <Text>Receipt: none</Text>
            )}
          </View>
        ))}
      </Card>
    </ScreenShell>
  );
}

