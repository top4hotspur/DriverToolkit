import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { GoOnlineNowDecisionContract } from "../contracts/goOnlineNow";
import { OfflineAction } from "../contracts/tasks";
import { BusinessMileageSummary } from "../contracts/tracking";
import { getLatestImportSummary } from "../engines/import/importPersistence";
import {
  getBusinessMileageSummary,
  startBusinessMileageTracking,
  stopBusinessMileageTracking,
} from "../engines/tracking/mileageTracker";
import { evaluateShouldGoOnlineNow } from "../presentation/goOnlineNow";
import { detectNewAchievementsAfterImport } from "../presentation/newAchievements";
import {
  placeholderBeenHereBefore,
  placeholderDashboard,
  placeholderOnlineGuidance,
  placeholderUsuallyNext,
} from "../presentation/placeholderData";
import { getOfflineContextualAchievementHighlight } from "../presentation/placeholderAchievements";
import { getCaughtUpState } from "../presentation/offlineTasks";
import { completeOutstandingAction, getOutstandingActions } from "../state/offlineActions";
import { getAppSettings } from "../state/settingsState";
import { getSessionState, setSessionMode } from "../state/sessionState";
import { SessionStateModel } from "../state/sessionTypes";
import { listStartPoints } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { shouldShowDueWarning, daysUntil } from "../utils/dueDates";
import {
  evidenceDetailFromSample,
  evidenceLabelFromConfidence,
  formatGBP,
  formatMiles,
  formatPercent,
} from "../utils/format";
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
  const [startPoints, setStartPoints] = useState<StartPoint[]>([]);
  const [goOnlineDecision, setGoOnlineDecision] = useState<GoOnlineNowDecisionContract | null>(null);
  const [outstandingActions, setOutstandingActions] = useState<OfflineAction[]>([]);
  const [latestImportToken, setLatestImportToken] = useState<string | null>(null);
  const [newAchievementResult, setNewAchievementResult] = useState(() => detectNewAchievementsAfterImport(0));

  const dueWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (settings?.psvDueDate && shouldShowDueWarning(settings.psvDueDate, 42)) {
      warnings.push(`PSV due in ${daysUntil(settings.psvDueDate)} days`);
    }
    if (settings?.insuranceDueDate && shouldShowDueWarning(settings.insuranceDueDate, 42)) {
      warnings.push(`Insurance renewal due in ${daysUntil(settings.insuranceDueDate)} days`);
    }
    if (settings?.operatorLicenceDueDate && shouldShowDueWarning(settings.operatorLicenceDueDate, 42)) {
      warnings.push(`Operator licence due in ${daysUntil(settings.operatorLicenceDueDate)} days`);
    }
    return warnings;
  }, [settings?.insuranceDueDate, settings?.operatorLicenceDueDate, settings?.psvDueDate]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const [storedSession, mileage, loadedSettings, latestImport, points] = await Promise.all([
        getSessionState(),
        getBusinessMileageSummary(),
        getAppSettings(),
        getLatestImportSummary(),
        listStartPoints(),
      ]);

      if (!mounted) {
        return;
      }

      const importToken = latestImport ? `${latestImport.importedAt}` : null;
      const newAchievements = detectNewAchievementsAfterImport(latestImport?.recordCount ?? 0);
      const actions = await getOutstandingActions({
        hasNewAchievements: newAchievements.hasNewAchievements,
        latestImportToken: importToken,
      });

      setSession(storedSession);
      setMileageSummary(mileage);
      setSettings(loadedSettings);
      setStartPoints(points);
      setLatestImportToken(importToken);
      setNewAchievementResult(newAchievements);
      setOutstandingActions(actions);
    }

    load().catch(() => {
      if (!mounted) {
        return;
      }
      setSettings(null);
      setStartPoints([]);
      setOutstandingActions([]);
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

    startBusinessMileageTracking(session.currentAreaLabel)
      .then((tracking) => setMileageSummary(tracking.summary))
      .catch(() => {
        // Safe fallback: keep UI responsive.
      });
  }, [mileageSummary.active, session.currentAreaLabel, session.mode]);

  useEffect(() => {
    if (session.mode !== "offline" || !mileageSummary.active) {
      return;
    }

    stopBusinessMileageTracking(session.currentAreaLabel)
      .then((tracking) => setMileageSummary(tracking.summary))
      .catch(() => {
        // Safe fallback: keep UI responsive.
      });
  }, [mileageSummary.active, session.currentAreaLabel, session.mode]);

  const onToggleSession = async () => {
    if (session.mode === "offline") {
      if (startPoints.length === 0) {
        setGoOnlineDecision({
          state: "unavailable",
          decision: null,
          userFacingDecisionLabel: "Reminder",
          headline: "Add preferred starting points",
          rationale: "Don't forget to set your preferred starting points - you can always change these later.",
          evidenceLabel: "No evidence",
          evidenceDetail: "No saved start points available for comparison yet.",
          basisWindowDays: 90,
          fallbackMessage: "Add at least one preferred starting point in Settings first.",
        });
      }
      const chosenArea = startPoints[0]?.postcode ?? session.currentAreaLabel ?? null;
      const tracking = await startBusinessMileageTracking(chosenArea);
      const next = await setSessionMode("online", chosenArea);
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
    try {
      const decision = await evaluateShouldGoOnlineNow({
        maxRadiusMiles: settings?.maxStartShiftTravelRadiusMiles ?? null,
        startPoints,
      });
      setGoOnlineDecision(decision);
    } catch {
      setGoOnlineDecision({
        state: "unavailable",
        decision: null,
        userFacingDecisionLabel: "Unavailable",
        headline: "Couldn't complete this check",
        rationale: "We couldn't check your location just now. Try again.",
        evidenceLabel: "No evidence",
        evidenceDetail: "No location comparison was completed.",
        basisWindowDays: 90,
        fallbackMessage: "We couldn't check your location just now. Try again.",
      });
    }
  };

  const onCompleteAction = async (actionId: string) => {
    await completeOutstandingAction(actionId);
    const refreshed = await getOutstandingActions({
      hasNewAchievements: newAchievementResult.hasNewAchievements,
      latestImportToken,
    });
    setOutstandingActions(refreshed);
  };

  const rec = placeholderDashboard.recommendation;
  const offlineHighlight = getOfflineContextualAchievementHighlight({
    now: new Date(),
    recentNewAchievements: newAchievementResult,
  });

  const taxSavings = settings?.taxSavingsAmount ?? 0;
  const estimatedLiability = settings?.estimatedTaxLiability ?? 0;
  const taxProgressRatio = estimatedLiability > 0 ? Math.min(taxSavings / estimatedLiability, 1) : 0;

  const upcomingWarnings = dueWarnings.filter((warning) =>
    warning.startsWith("PSV") || warning.startsWith("Insurance") || warning.startsWith("Operator"),
  );
  const setupReminders: string[] = [];
  if (!settings?.psvDueDate) {
    setupReminders.push("Add your PSV expiry date in Settings.");
  }
  if (!settings?.insuranceDueDate) {
    setupReminders.push("Add your insurance renewal date in Settings.");
  }
  if (!settings?.operatorLicenceDueDate) {
    setupReminders.push("Add your operator licence expiry date in Settings.");
  }

  return (
    <ScreenShell
      title="Dashboard"
      subtitle="Decision-first co-pilot built on imported history and local controls."
      footerCta={<PrimaryButton label="Upload privacy file" onPress={() => router.push("/upload")} />}
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
              ? `Online - ${session.currentAreaLabel ?? startPoints[0]?.postcode ?? "BT1"}`
              : session.currentAreaLabel
                ? `Offline - ${session.currentAreaLabel}`
                : "Offline"}
          </Text>
        </Pressable>
        <Text style={styles.statusHint}>{session.mode === "online" ? "Tap to go offline" : "Tap to go online"}</Text>
      </Card>

      {session.mode === "online" ? (
        <>
          <Card title="Current Location Context">
            <Text>
              {session.currentAreaLabel
                ? `${session.currentAreaLabel} is currently the active start context.`
                : "Location context is available after choosing a preferred start point."}
            </Text>
          </Card>

          <Card title="Recommended Action">
            <Text style={{ fontWeight: "700", fontSize: 20, textTransform: "capitalize" }}>{rec.action}</Text>
            <ConfidenceBadge
              evidenceLabel={evidenceLabelFromConfidence(rec.confidence)}
              evidenceDetail={evidenceDetailFromSample(rec.sampleSize, "comparable starts")}
            />
            <Text>{rec.rationale}</Text>
            <Text>{`Basis: ${rec.basisWindow.label}`}</Text>
          </Card>

          <Card title="Historical Context Guidance">
            <Text>
              This area is usually <Text style={styles.keyTermWeak}>weaker</Text> for this time.
            </Text>
            <Text>{placeholderOnlineGuidance.shiftHint}</Text>
            <Text>
              Nearby options in your radius may be <Text style={styles.keyTermStrong}>stronger</Text>, especially BT7.
            </Text>
          </Card>

          <Card title="What Usually Happens Here?">
            <KeyValueRow label="Average wait here" value={`${placeholderBeenHereBefore.averageWaitMinutes.toFixed(1)} mins`} />
            <KeyValueRow label="Average first fare here" value={formatGBP(placeholderBeenHereBefore.averageFirstFare)} />
            <KeyValueRow
              label="Typical 60 / 90 min return"
              value={`${formatGBP(placeholderBeenHereBefore.likelyOutcome60Minutes)} / ${formatGBP(placeholderBeenHereBefore.likelyOutcome90Minutes)}`}
            />
            <KeyValueRow label="Follow-on chance" value={formatPercent(placeholderBeenHereBefore.followOnRate)} />
            <KeyValueRow label="Most common next job type" value={placeholderUsuallyNext.likelyNextJobType} />
          </Card>

          <Card title="Business Mileage Tracking">
            <KeyValueRow label="Tracking status" value={mileageSummary.active ? "Active" : "Paused"} />
            <KeyValueRow label="Tracked business miles" value={formatMiles(mileageSummary.trackedBusinessMiles)} />
            <Text>GPS mileage tracking runs only while online.</Text>
          </Card>

          <Card title="Quick Actions">
            <PrimaryButton label="Upload expense" onPress={() => router.push("/reports")} />
            <PrimaryButton label="Add cash expense" onPress={() => router.push("/reports")} />
            <PrimaryButton label="Upload privacy file" onPress={() => router.push("/upload")} />
          </Card>
        </>
      ) : (
        <>
          <Card title="Should I Go Online Now?">
            <Text>Tap to compare nearby preferred start points using historical performance at this time.</Text>
            <PrimaryButton label="Should I go online now?" onPress={onShouldGoOnlineNow} />
            {goOnlineDecision ? (
              <View style={{ marginTop: 8, gap: 4 }}>
                <Text style={{ fontWeight: "700" }}>{goOnlineDecision.headline}</Text>
                <Text>{goOnlineDecision.rationale}</Text>
                {goOnlineDecision.state === "decision" ? (
                  <Text>{goOnlineDecision.userFacingDecisionLabel}</Text>
                ) : null}
                <ConfidenceBadge
                  evidenceLabel={goOnlineDecision.evidenceLabel}
                  evidenceDetail={goOnlineDecision.evidenceDetail}
                />
                {goOnlineDecision.comparedAreaLabel ? (
                  <Text>{`Alternative: ${goOnlineDecision.comparedAreaLabel} (${goOnlineDecision.comparedAreaDistanceMiles?.toFixed(1)} miles)`}</Text>
                ) : null}
              </View>
            ) : null}
          </Card>

          {(upcomingWarnings.length > 0 || setupReminders.length > 0) ? (
            <Card title="Upcoming Warnings">
              {upcomingWarnings.map((warning, index) => (
                <Text key={`warn-${index}`}>{warning}</Text>
              ))}
              {setupReminders.map((reminder, index) => (
                <Text key={`setup-${index}`}>{reminder}</Text>
              ))}
            </Card>
          ) : null}

          <Card title="Outstanding Actions">
            {outstandingActions.map((action) => (
              <View key={action.id} style={{ marginBottom: 10, gap: 6 }}>
                <Text>{`${action.priority.toUpperCase()}: ${action.label}`}</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {action.relatedRoute ? (
                    <PrimaryButton label={action.actionLabel} onPress={() => router.push(action.relatedRoute as never)} />
                  ) : null}
                  <PrimaryButton label="Mark done" onPress={() => onCompleteAction(action.id)} />
                </View>
              </View>
            ))}
            {getCaughtUpState(outstandingActions) ? (
              <View style={{ gap: 8 }}>
                <Text>{getCaughtUpState(outstandingActions)}</Text>
                <PrimaryButton label="Upload privacy file" onPress={() => router.push("/upload")} />
              </View>
            ) : null}
          </Card>

          <Card title="Tax Progress">
            <KeyValueRow label="Tax savings" value={formatGBP(taxSavings)} />
            <KeyValueRow label="Estimated liability" value={formatGBP(estimatedLiability)} />
            <KeyValueRow label="Progress" value={formatPercent(taxProgressRatio)} />
            <KeyValueRow label="Remaining gap" value={formatGBP(Math.max(estimatedLiability - taxSavings, 0))} />
          </Card>

          <Card title="Achievement Highlight">
            <Text>{offlineHighlight.title}</Text>
            <Text>{offlineHighlight.metricValue}</Text>
            <Text>{`When: ${offlineHighlight.occurredAt}`}</Text>
            <Text>{offlineHighlight.oneLineExplanation}</Text>
            {newAchievementResult.hasNewAchievements ? (
              <Text>{`New since upload: ${newAchievementResult.events[0].headline}`}</Text>
            ) : null}
          </Card>

          <Card title="Quick Actions">
            <PrimaryButton label="Upload expense" onPress={() => router.push("/reports")} />
            <PrimaryButton label="Add cash expense" onPress={() => router.push("/reports")} />
            <PrimaryButton label="Upload privacy file" onPress={() => router.push("/upload")} />
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
  keyTermWeak: {
    color: "#8a3a3a",
    fontWeight: "700",
  },
  keyTermStrong: {
    color: "#256d4f",
    fontWeight: "700",
  },
});
