import { useLocalSearchParams } from "expo-router";
import { ReportType } from "../../../src/domain/types";
import { DetailedAnalysisScreen } from "../../../src/screens/DetailedAnalysisScreen";
import { REPORT_REGISTRY } from "../../../src/contracts/reportRegistry";

const VALID_REPORT_IDS = REPORT_REGISTRY.map((entry) => entry.id);

export default function DetailRoute() {
  const params = useLocalSearchParams<{ reportId?: string }>();
  const candidate = params.reportId as ReportType;
  const reportId = VALID_REPORT_IDS.includes(candidate) ? candidate : "journey-regret";

  return <DetailedAnalysisScreen reportId={reportId} />;
}
