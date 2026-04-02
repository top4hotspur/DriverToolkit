import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DayAnomaly, DiaryPlannerOutput, OpportunityWindow } from "../contracts/diary";
import { buildSmartDiaryPlannerWithRail } from "../presentation/smartDiaryAdvisory";
import { listStartPoints } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { Card, ScreenShell } from "./ui";

export function SmartDiaryScreen() {
  const [favourites, setFavourites] = useState<StartPoint[]>([]);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [planner, setPlanner] = useState<DiaryPlannerOutput>(() => emptyPlanner(new Date()));

  useEffect(() => {
    listStartPoints()
      .then((rows) => setFavourites(rows))
      .catch(() => setFavourites([]));
  }, []);

  useEffect(() => {
    let active = true;
    const now = new Date();

    buildSmartDiaryPlannerWithRail({
      favourites,
      now,
    })
      .then((next) => {
        if (active) {
          setPlanner(next);
          setSelectedDayIndex((prev) => Math.min(prev, Math.max(0, next.days.length - 1)));
        }
      })
      .catch(() => {
        if (active) {
          setPlanner(emptyPlanner(now));
        }
      });

    return () => {
      active = false;
    };
  }, [favourites]);

  const selectedDay = planner.days[selectedDayIndex] ?? planner.days[0];

  return (
    <ScreenShell
      title="Smart Diary"
      subtitle="7 day rolling planner from favourites and live disruption monitoring"
    >
      <Card title="Next 7 Days">
        <View style={styles.daySelectorWrap}>
          {planner.days.map((day, index) => (
            <Pressable
              key={day.day.dateIso}
              onPress={() => setSelectedDayIndex(index)}
              style={[
                styles.dayChip,
                index === selectedDayIndex ? styles.dayChipSelected : styles.dayChipDefault,
              ]}
            >
              <Text
                style={[
                  styles.dayChipText,
                  index === selectedDayIndex ? styles.dayChipTextSelected : styles.dayChipTextDefault,
                ]}
              >
                {day.day.selectorLabel}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.selectedDayLabel}>{selectedDay.day.dayLabel}</Text>
      </Card>

      <Card title="Anomalies / Disruption">
        {selectedDay.anomalies.length === 0 ? (
          <Text>Nothing notable to flag for this day.</Text>
        ) : (
          selectedDay.anomalies.map((anomaly) => <AnomalyRow key={anomaly.id} anomaly={anomaly} />)
        )}
      </Card>

      <Card title="Planned Opportunities">
        {selectedDay.opportunities.length === 0 ? (
          <Text>No notable diary windows found for this day.</Text>
        ) : (
          selectedDay.opportunities.map((opportunity) => (
            <OpportunityRow key={opportunity.id} opportunity={opportunity} />
          ))
        )}
      </Card>
    </ScreenShell>
  );
}

function AnomalyRow(props: { anomaly: DayAnomaly }) {
  const windowText = `${formatTime(props.anomaly.startsAt)}-${formatTime(props.anomaly.endsAt)}`;
  return (
    <View style={styles.rowWrap}>
      <Text style={styles.rowTitle}>{windowText}</Text>
      <Text>{props.anomaly.message}</Text>
    </View>
  );
}

function emptyPlanner(now: Date): DiaryPlannerOutput {
  const dateIso = now.toISOString();
  return {
    generatedAt: dateIso,
    basisLabel: "7 day rolling planner from favourites and live disruption monitoring",
    sourceAnchors: [],
    days: [
      {
        day: {
          dateIso,
          dayLabel: now.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "2-digit",
            month: "short",
            year: "numeric",
          }),
          selectorLabel: "Today",
          isToday: true,
          isTomorrow: false,
        },
        anomalies: [],
        opportunities: [],
      },
    ],
  };
}

function OpportunityRow(props: { opportunity: OpportunityWindow }) {
  const windowText = `${formatTime(props.opportunity.startsAt)}-${formatTime(props.opportunity.endsAt)}`;
  return (
    <View style={styles.rowWrap}>
      <Text style={styles.rowTitle}>{`${windowText} - ${props.opportunity.anchorLabel}`}</Text>
      <Text>{props.opportunity.title}</Text>
      <Text>{props.opportunity.detail}</Text>
    </View>
  );
}

function formatTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const styles = StyleSheet.create({
  daySelectorWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dayChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  dayChipDefault: {
    backgroundColor: "#eef2ec",
    borderColor: "#c9d1c8",
  },
  dayChipSelected: {
    backgroundColor: "#1f5f46",
    borderColor: "#1f5f46",
  },
  dayChipText: {
    fontWeight: "700",
    fontSize: 12,
  },
  dayChipTextDefault: {
    color: "#1f302b",
  },
  dayChipTextSelected: {
    color: "#f3f8f4",
  },
  selectedDayLabel: {
    marginTop: 8,
    color: "#30443d",
    fontWeight: "600",
  },
  rowWrap: {
    marginBottom: 10,
    gap: 3,
  },
  rowTitle: {
    fontWeight: "700",
    color: "#1f302b",
  },
});
