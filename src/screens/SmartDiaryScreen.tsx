import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DayAnomaly, OpportunityWindow } from "../contracts/diary";
import { buildSmartDiaryPlanner } from "../presentation/smartDiaryAdvisory";
import { listStartPoints } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { Card, ScreenShell } from "./ui";

export function SmartDiaryScreen() {
  const [favourites, setFavourites] = useState<StartPoint[]>([]);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  useEffect(() => {
    listStartPoints()
      .then((rows) => setFavourites(rows))
      .catch(() => setFavourites([]));
  }, []);

  const planner = useMemo(
    () =>
      buildSmartDiaryPlanner({
        favourites,
        now: new Date(),
      }),
    [favourites],
  );

  const selectedDay = planner.days[selectedDayIndex] ?? planner.days[0];

  return (
    <ScreenShell
      title="Smart Diary"
      subtitle="7 day rolling planner from favourites and live disruption monitoring"
    >
      <Card title="Planner Basis" compact>
        <Text>{planner.basisLabel}</Text>
      </Card>

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
          <Text>No major disruption signals detected for this day.</Text>
        ) : (
          selectedDay.anomalies.map((anomaly) => <AnomalyRow key={anomaly.id} anomaly={anomaly} />)
        )}
      </Card>

      <Card title="Planned Opportunities">
        {selectedDay.opportunities.length === 0 ? (
          <Text>No high-signal windows detected from your monitored anchors for this day.</Text>
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
  const severity = mapSeverity(props.anomaly.severity);
  const windowText = `${formatTime(props.anomaly.startsAt)}-${formatTime(props.anomaly.endsAt)}`;
  return (
    <View style={styles.rowWrap}>
      <Text style={styles.rowTitle}>{`${severity} | ${windowText}`}</Text>
      <Text>{props.anomaly.message}</Text>
    </View>
  );
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

function mapSeverity(value: DayAnomaly["severity"]): string {
  if (value === "high") {
    return "High impact";
  }
  if (value === "warning") {
    return "Warning";
  }
  return "Heads-up";
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
