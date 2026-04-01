import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { placeholderBeenHereBefore, placeholderDashboard, placeholderUsuallyNext } from "../presentation/placeholderData";
import { Card, ConfidenceBadge, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

export function DashboardScreen() {
  const router = useRouter();
  const rec = placeholderDashboard.recommendation;

  return (
    <ScreenShell
      title="Dashboard"
      subtitle="Decision-first co-pilot from imported history, local costs, and diary context."
      footerCta={<PrimaryButton label="Upload Privacy File" onPress={() => router.push("/upload")} />}
    >
      <Card title="Evaluating Context State">
        <Text>{placeholderDashboard.contextState}</Text>
        <Text>{rec.basisWindow.label}</Text>
      </Card>

      <Card title="Recommended Action">
        <Text style={{ fontWeight: "700", fontSize: 20, textTransform: "capitalize" }}>{rec.action}</Text>
        <ConfidenceBadge level={rec.confidence} sampleSize={rec.sampleSize} />
        <Text>{rec.rationale}</Text>
        {rec.alternative ? <Text>{`Alternative: ${rec.alternative.action} - ${rec.alternative.rationale}`}</Text> : null}
      </Card>

      <Card title="Have I Been Here Before?">
        <KeyValueRow label="Avg wait" value={`${placeholderBeenHereBefore.averageWaitMinutes.toFixed(1)} mins`} />
        <KeyValueRow label="Avg first fare" value={`£${placeholderBeenHereBefore.averageFirstFare.toFixed(2)}`} />
        <KeyValueRow
          label="Likely 60 / 90 minute outcome"
          value={`£${placeholderBeenHereBefore.likelyOutcome60Minutes.toFixed(2)} / £${placeholderBeenHereBefore.likelyOutcome90Minutes.toFixed(2)}`}
        />
        <KeyValueRow label="Follow-on rate" value={`${Math.round(placeholderBeenHereBefore.followOnRate * 100)}%`} />
      </Card>

      <Card title="What Usually Happens Next?">
        <KeyValueRow label="Likely job type" value={placeholderUsuallyNext.likelyNextJobType} />
        <KeyValueRow label="Likely wait" value={`${placeholderUsuallyNext.likelyWaitMinutes.toFixed(1)} mins`} />
        <KeyValueRow label="Expected 60 / 90 min yield" value={`£${placeholderUsuallyNext.expectedYield60Minutes.toFixed(2)} / £${placeholderUsuallyNext.expectedYield90Minutes.toFixed(2)}`} />
      </Card>

      <Card title="Opportunity Nudge">
        <Text>{placeholderDashboard.opportunityNudge}</Text>
      </Card>

      <Card title="Low-Value / Min-Accept Grid">
        {placeholderDashboard.lowValueAreas.map((area) => (
          <View key={area.area} style={{ marginBottom: 8 }}>
            <KeyValueRow label={area.area} value={`Min £${area.minAcceptFare.toFixed(2)}`} />
            <Text>{area.note}</Text>
          </View>
        ))}
      </Card>
    </ScreenShell>
  );
}
