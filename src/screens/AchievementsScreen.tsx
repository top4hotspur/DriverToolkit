import { Alert, Text } from "react-native";
import { placeholderAchievements } from "../presentation/placeholderAchievements";
import { evidenceDetailFromSample, evidenceLabelFromConfidence } from "../utils/format";
import { Card, ConfidenceBadge, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

export function AchievementsScreen() {
  const handleShareStub = (text: string) => {
    Alert.alert("Share (placeholder)", `WhatsApp-first share stub:\n\n${text}`);
  };

  return (
    <ScreenShell
      title="Achievements"
      subtitle="Fun, shareable records grounded in imported-history truth."
    >
      <Card title="Historical Basis">
        <KeyValueRow label="Basis" value={placeholderAchievements.basisLabel} />
      </Card>

      {placeholderAchievements.cards.map((card) => (
        <Card key={card.type} title={card.title}>
          <KeyValueRow label="Metric" value={card.metricValue} />
          <KeyValueRow label="Date / Time" value={card.occurredAt} />
          <KeyValueRow label="Context" value={card.areaOrContext} />
          <Text>{card.oneLineExplanation}</Text>
          <ConfidenceBadge
            evidenceLabel={evidenceLabelFromConfidence(card.confidence)}
            evidenceDetail={evidenceDetailFromSample(card.sampleSize, "similar records")}
          />
          <PrimaryButton label={card.shareCtaLabel} onPress={() => handleShareStub(card.shareText)} />
        </Card>
      ))}
    </ScreenShell>
  );
}
