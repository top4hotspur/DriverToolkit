import { useEffect, useState } from "react";
import { Text } from "react-native";
import { placeholderDiary } from "../presentation/placeholderData";
import { buildSmartDiaryFromFavourites } from "../presentation/smartDiaryAdvisory";
import { listStartPoints } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { Card, ScreenShell } from "./ui";

export function SmartDiaryScreen() {
  const [favourites, setFavourites] = useState<StartPoint[]>([]);

  useEffect(() => {
    listStartPoints()
      .then((rows) => setFavourites(rows))
      .catch(() => setFavourites([]));
  }, []);

  const advisory = buildSmartDiaryFromFavourites({
    favourites,
    now: new Date(),
  });

  const cards = advisory.entries.length > 0
    ? advisory.entries.map((entry) => ({
        title: entry.title,
        window: entry.window,
        note: entry.note,
        confidence: `${entry.confidence} confidence`,
      }))
    : placeholderDiary.cards;

  return (
    <ScreenShell
      title="Smart Diary"
      subtitle="Historical + event-informed schedule guidance with bounded confidence."
    >
      <Card title="Advisory Basis">
        <Text>{advisory.entries.length > 0 ? advisory.basisLabel : placeholderDiary.basisLabel}</Text>
      </Card>

      {cards.map((entry) => (
        <Card key={entry.title} title={entry.title}>
          <Text>{entry.window}</Text>
          <Text>{entry.note}</Text>
          <Text>{entry.confidence}</Text>
        </Card>
      ))}
    </ScreenShell>
  );
}
