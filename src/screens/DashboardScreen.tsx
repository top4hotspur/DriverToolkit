import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { GoOnlineNowDecisionContract } from "../contracts/goOnlineNow";
import { BusinessMileageSummary } from "../contracts/tracking";
import { getLatestImportSummary } from "../engines/import/importPersistence";
import {
  getBusinessMileageSummary,
  startBusinessMileageTracking,
  stopBusinessMileageTracking,
} from "../engines/tracking/mileageTracker";
import { detectNewAchievementsAfterImport } from "../presentation/newAchievements";
import { getOfflineTasksPlaceholder } from "../presentation/offlineTasks";
import {
  placeholderBeenHereBefore,
  placeholderDashboard,
  placeholderOnlineGuidance,
  placeholderUsuallyNext,
} from "../presentation/placeholderData";
import { getOfflineContextualAchievementHighlight } from "../presentation/placeholderAchievements";
import { evaluateShouldGoOnlineNow } from "../presentation/goOnlineNow";
import { getDueWarnings } from "../presentation/placeholderSettings";
import { getAppSettings } from "../state/settingsState";
import { getSessionState, setSessionMode } from "../state/sessionState";
import { SessionStateModel } from "../state/sessionTypes";
import { formatGBP, formatMiles, formatPercent } from "../utils/format";
import { Card, ConfidenceBadge, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

const defaultMileageSummary: BusinessMileageSummary = {
  active: false,
  activeSessionId: null,
  trackedBusinessMiles: 0,
  trackingStartedAt: null,
  trackingStoppedAt: null,
};

export function DashboardScreen() {
  const router = useRouter();
  const pulse = useRef(new Animated.Value(0)).current;
  const [session, setSession] = useState<SessionStateModel>({
    mode: "offline",
    currentAreaLabel: null,
    trackingStartedAt: null,
    trackingStoppedAt: null,
    businessMileageTrackingEnabled: false,
  });
  const [mileageSummary, setMileageSummary] = useState<BusinessMileageSummary>(defaultMileageSummary);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getAppSettings>> | null>(null);
  const [goOnlineDecision, setGoOnlineDecision] = useState<GoOnlineNowDecisionContract | null>(null);
  const [newAchievementResult, setNewAchievementResult] = useState(() => detectNewAchievementsAfterImport(0));

  const dueWarnings = useMemo(() => getDueWarnings(), []);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const [storedSession, mileage, loadedSettings, latestImport] = await Promise.all([
        getSessionState(),
        getBusinessMileageSummary(),
        getAppSettings(),
        getLatestImportSummary(),
      ]);

      if (!mounted) {
        return;
      }

      setSession(storedSession);
      setMileageSummary(mileage);
      setSettings(loadedSettings);
      setNewAchievementResult(detectNewAchievementsAfterImport(latestImport?.recordCount ?? 0));
    }

    load().catch(() => {
      if (!mounted) {
        return;
      }
      setSettings(null);
    });

    const interval = setInterval(() => {
      getBusinessMileageSummary().then((next) => {
        if (mounted) {
          setMileageSummary(next);
        }
      });
    }, 15_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (session.mode !== "online") {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, session.mode]);

  useEffect(() => {
    if (session.mode !== "online" || mileageSummary.active) {
      return;
    }

    startBusinessMileageTracking(session.currentAreaLabel ?? "Current Area")
      .then((tracking) => setMileageSummary(tracking.summary))
      .catch(() => {
        // Keep screen responsive even if tracking cannot start.
      });
  }, [mileageSummary.active, session.currentAreaLabel, session.mode]);

  useEffect(() => {
    if (session.mode !== "offline" || !mileageSummary.active) {
      return;
    }

    stopBusinessMileageTracking(session.currentAreaLabel)
      .then((tracking) => setMileageSummary(tracking.summary))
      .catch(() => {
        // Keep screen responsive even if tracking cannot stop cleanly.
      });
  }, [mileageSummary.active, session.currentAreaLabel, session.mode]);

  const onToggleSession = async () => {
    if (session.mode === "offline") {
      const tracking = await startBusinessMileageTracking(session.currentAreaLabel ?? "Current Area");
      const next = await setSessionMode("online", session.currentAreaLabel ?? "Current Area");
      setSession(next);
      setMileageSummary(tracking.summary);
      return;
    }

    const tracking = await stopBusinessMileageTracking(session.currentAreaLabel);
    const next = await setSessionMode("offline", session.currentAreaLabel);
    setSession(next);
    setMileageSummary(tracking.summary);
    setGoOnlineDecision(null);
  };

  const onShouldGoOnlineNow = async () => {
    const maxRadius = settings?.maxStartShiftTravelRadiusMiles ?? 5;
    const decision = await evaluateShouldGoOnlineNow({ maxRadiusMiles: maxRadius });
    setGoOnlineDecision(decision);
  };

  const rec = placeholderDashboard.recommendation;
  const offlineHighlight = getOfflineContextualAchievementHighlight({
    now: new Date(),
    recentNewAchievements: newAchievementResult,
  });

  const taxSavings = settings?.taxSavingsAmount ?? 0;
  const estimatedLiability = settings?.estimatedTaxLiability ?? 0;
  const taxProgressRatio = estimatedLiability > 0 ? Math.min(taxSavings / estimatedLiability, 1) : 0;

  return (
    <ScreenShell
      title="Dashboard"
      subtitle="Decision-first co-pilot built on imported history and local controls."
      footerCta={<PrimaryButton label="Upload Privacy File" onPress={() => router.push("/upload")} />}
    >
      <Card title="Session Status">
        <Pressable onPress={onToggleSession} style={[styles.statusPill, session.mode === "online" ? styles.onlinePill : styles.offlinePill]}>
          {session.mode === "online" ? (
            <Animated.View
              style={[
                styles.pulseDot,
                {
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.25] }) }],
                },
              ]}
            />
          ) : (
            <View style={styles.offlineDot} />
          )}
          <Text style={styles.statusText}>
            {session.mode === "online"
              ? `Online - ${session.currentAreaLabel ?? "Current Area"}`
              : "Offline"}
          </Text>
        </Pressable>
        <Text style={styles.statusHint}>Tap to switch mode.</Text>
      </Card>

      {session.mode === "online" ? (
        <>
          <Card title="Business Mileage Tracking">
            <KeyValueRow label="Tracking status" value={mileageSummary.active ? "Active" : "Paused"} />
            <KeyValueRow label="Tracked business miles" value={formatMiles(mileageSummary.trackedBusinessMiles)} />
            <Text>GPS tracking is active only while online for business mileage records.</Text>
          </Card>

          <Card title="Historical Context Guidance">
            <Text>{placeholderOnlineGuidance.areaStrength}</Text>
            <Text>{placeholderOnlineGuidance.nearbyAlternative}</Text>
            <Text>{placeholderOnlineGuidance.shiftHint}</Text>
          </Card>

          <Card title="Recommended Action">
            <Text style={{ fontWeight: "700", fontSize: 20, textTransform: "capitalize" }}>{rec.action}</Text>
            <ConfidenceBadge level={rec.confidence} sampleSize={rec.sampleSize} />
            <Text>{rec.rationale}</Text>
            <Text>{`Basis: ${rec.basisWindow.label}`}</Text>
          </Card>

          <Card title="Comparable Context Signals">
            <KeyValueRow label="Avg wait" value={`${placeholderBeenHereBefore.averageWaitMinutes.toFixed(1)} mins`} />
            <KeyValueRow label="Avg first fare (historical)" value={formatGBP(placeholderBeenHereBefore.averageFirstFare)} />
            <KeyValueRow
              label="Historical 60 / 90 min outcomes"
              value={`${formatGBP(placeholderBeenHereBefore.likelyOutcome60Minutes)} / ${formatGBP(placeholderBeenHereBefore.likelyOutcome90Minutes)}`}
            />
            <KeyValueRow label="Follow-on rate" value={formatPercent(placeholderBeenHereBefore.followOnRate)} />
            <KeyValueRow label="Likely next job type" value={placeholderUsuallyNext.likelyNextJobType} />
          </Card>
        </>
      ) : (
        <>
          <Card title="Tax Progress">
            <KeyValueRow label="Tax savings" value={formatGBP(taxSavings)} />
            <KeyValueRow label="Estimated liability" value={formatGBP(estimatedLiability)} />
            <KeyValueRow label="Progress" value={formatPercent(taxProgressRatio)} />
            <KeyValueRow label="Remaining gap" value={formatGBP(Math.max(estimatedLiability - taxSavings, 0))} />
          </Card>

          <Card title="Outstanding Tasks">
            {getOfflineTasksPlaceholder().map((task) => (
              <Text key={task.id}>{`${task.priority.toUpperCase()}: ${task.label}`}</Text>
            ))}
          </Card>

          <Card title="PSV Countdown">
            {dueWarnings.find((warning) => warning.startsWith("PSV")) ? (
              <Text>{dueWarnings.find((warning) => warning.startsWith("PSV"))}</Text>
            ) : (
              <Text>No PSV warning in the next 6 weeks.</Text>
            )}
          </Card>

          <Card title="Insurance Countdown">
            {dueWarnings.find((warning) => warning.startsWith("Insurance")) ? (
              <Text>{dueWarnings.find((warning) => warning.startsWith("Insurance"))}</Text>
            ) : (
              <Text>No insurance warning in the next 6 weeks.</Text>
            )}
          </Card>

          <Card title="Should I Go Online Now?">
            <Text>
              One-tap historical comparison using this time window and nearby areas within your configured start radius.
            </Text>
            <PrimaryButton label="Should I go online now?" onPress={onShouldGoOnlineNow} />
            {goOnlineDecision ? (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontWeight: "700" }}>{goOnlineDecision.headline}</Text>
                <Text>{goOnlineDecision.rationale}</Text>
                <Text>{`Decision: ${goOnlineDecision.decision}`}</Text>
                <Text>{`Confidence: ${goOnlineDecision.confidence} · n=${goOnlineDecision.sampleSize}`}</Text>
                {goOnlineDecision.comparedAreaLabel ? (
                  <Text>
                    {`Alternative: ${goOnlineDecision.comparedAreaLabel} (${goOnlineDecision.comparedAreaDistanceMiles?.toFixed(1)} miles)`}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Card>

          <Card title="Achievement Highlight">
            <Text>{offlineHighlight.title}</Text>
            <Text>{offlineHighlight.metricValue}</Text>
            <Text>{offlineHighlight.oneLineExplanation}</Text>
            {newAchievementResult.hasNewAchievements ? (
              <Text>{`New since upload: ${newAchievementResult.events[0].headline}`}</Text>
            ) : (
              <Text>No new records since latest upload.</Text>
            )}
          </Card>
        </>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  statusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  onlinePill: {
    backgroundColor: "#214e3f",
  },
  offlinePill: {
    backgroundColor: "#5b645f",
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#7cffbe",
  },
  offlineDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#c6cbc8",
  },
  statusText: {
    color: "#f3f8f4",
    fontWeight: "700",
  },
  statusHint: {
    marginTop: 8,
    color: "#415049",
  },
});
