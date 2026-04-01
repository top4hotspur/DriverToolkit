import { Text } from "react-native";
import { placeholderClaims } from "../presentation/placeholderClaims";
import { Card, ConfidenceBadge, KeyValueRow, ScreenShell } from "./ui";

export function ClaimsFeesScreen() {
  return (
    <ScreenShell
      title="Claims & Fees"
      subtitle="Recovery surface for likely missed money from imported historical data."
    >
      <Card title="Totals Identified">
        <KeyValueRow label="Estimated recoverable" value={`£${placeholderClaims.totalEstimatedValue.toFixed(2)}`} />
        <KeyValueRow label="Open items" value={`${placeholderClaims.openItems}`} />
      </Card>

      <Card title="Issue-Type Filters">
        {placeholderClaims.issueBreakdown.map((issue) => (
          <KeyValueRow
            key={issue.type}
            label={`${issue.type} (${issue.count})`}
            value={`£${issue.estimatedValue.toFixed(2)}`}
          />
        ))}
      </Card>

      {placeholderClaims.leaks.map((leak, index) => (
        <Card key={`${leak.type}-${index}`} title={leak.type}>
          <ConfidenceBadge level={leak.confidence} sampleSize={placeholderClaims.openItems} />
          <Text>{leak.explanation}</Text>
          <Text>{`Claim helper: ${leak.claimHelperText}`}</Text>
          <Text>{`Estimated value: £${leak.estimatedValue.toFixed(2)}`}</Text>
        </Card>
      ))}
    </ScreenShell>
  );
}
