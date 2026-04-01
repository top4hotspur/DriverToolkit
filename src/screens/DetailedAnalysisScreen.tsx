import { Text } from "react-native";
import { ReportType } from "../domain/types";
import { getPlaceholderReportDetail } from "../presentation/placeholderReports";
import { Card, ScreenShell } from "./ui";

export function DetailedAnalysisScreen(props: { reportId: ReportType }) {
  const detail = getPlaceholderReportDetail(props.reportId);

  return (
    <ScreenShell title={detail.title} subtitle="Actionable drill-down with IF / THEN guidance.">
      <Card title="Report Basis">
        <Text>{`Correct to: ${detail.correctToDate}`}</Text>
        <Text>{detail.basisWindowNote}</Text>
        <Text>{detail.confidenceLabel}</Text>
      </Card>

      <Card title="Actionable Insight">
        <Text>{detail.actionableInsight}</Text>
      </Card>

      <Card title="IF / THEN Rules">
        {detail.ifThenRules.map((rule) => (
          <Text key={rule.if}>{`${rule.if} -> ${rule.then}`}</Text>
        ))}
      </Card>

      <Card title="Comparison Table">
        {detail.comparisonRows.map((row) => (
          <Text key={row.label}>{`${row.label}: ${row.yourValue} vs ${row.comparableValue} (${row.delta})`}</Text>
        ))}
      </Card>

      <Card title="Takeaway">
        <Text>{detail.takeaway}</Text>
      </Card>
    </ScreenShell>
  );
}
