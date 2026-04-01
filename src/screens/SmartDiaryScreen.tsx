import { Text } from "react-native";
import { placeholderDiary } from "../presentation/placeholderData";
import { Card, ScreenShell } from "./ui";

export function SmartDiaryScreen() {
  return (
    <ScreenShell
      title="Smart Diary"
      subtitle="Historical + event-informed schedule guidance with bounded confidence."
    >
      <Card title="Advisory Basis">
        <Text>{placeholderDiary.basisLabel}</Text>
      </Card>

      {placeholderDiary.cards.map((entry) => (
        <Card key={entry.title} title={entry.title}>
          <Text>{entry.window}</Text>
          <Text>{entry.note}</Text>
          <Text>{entry.confidence}</Text>
        </Card>
      ))}
    </ScreenShell>
  );
}
