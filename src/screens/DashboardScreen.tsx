import * as Location from "expo-location";
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
import { getSessionState, setCurrentAreaLabel, setSessionMode } from "../state/sessionState";
import { SessionStateModel } from "../state/sessionTypes";
import { listStartPoints } from "../state/startPoints";
import { StartPoint } from "../state/startPointTypes";
import { daysUntil, shouldShowDueWarning } from "../utils/dueDates";
import { deriveUkOutwardCode } from "../utils/postcodes";
import {
  evidenceDetailFromSample,
  evidenceLabelFromConfidence,
  formatDurationClock,
  formatGBP,
  formatMiles,
  formatPercent,
  formatUkDate,
  formatUkDateTime,
} from "../utils/format";
import { Card, ConfidenceBadge, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

const defaultMileageSummary: BusinessMileageSummary = {
  active: false,
  activeSessionId: null,
  trackedBusinessMiles: 0,
  trackingStartedAt: null,
  trackingStoppedAt: null,
  accumulatedOnlineSeconds: 0,
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
    accumulatedOnlineSeconds: 0,
  });
  const [mileageSummary, setMileageSummary] = useState<BusinessMileageSummary>(defaultMileageSummary);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getAppSettings>> | null>(null);
  const [startPoints, setStartPoints] = useState<StartPoint[]>([]);
  const [goOnlineDecision, setGoOnlineDecision] = useState<GoOnlineNowDecisionContract | null>(null);
  const [outstandingActions, setOutstandingActions] = useState<OfflineAction[]>([]);
  const [latestImportToken, setLatestImportToken] = useState<string | null>(null);
  const [newAchievementResult, setNewAchievementResult] = useState(() => detectNewAchievementsAfterImport(0));
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [liveNow, setLiveNow] = useState(() => Date.now());

  const dueWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (settings?.psvDueDate && shouldShowDueWarning(settings.psvDueDate, 42)) {
      warnings.push(`PSV due in ${daysUntil(settings.psvDueDate)} days (${formatUkDate(settings.psvDueDate)})`);
    }
    if (settings?.insuranceDueDate && shouldShowDueWarning(settings.insuranceDueDate, 42)) {
      warnings.push(`Insurance renewal due in ${daysUntil(settings.insuranceDueDate)} days (${formatUkDate(settings.insuranceDueDate)})`);
    }
    if (settings?.operatorLicenceDueDate && shouldShowDueWarning(settings.operatorLicenceDueDate, 42)) {
      warnings.push(`Operator licence due in ${daysUntil(settings.operatorLicenceDueDate)} days (${formatUkDate(settings.operatorLicenceDueDate)})`);
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
      setActionMessage("We couldn't load your dashboard context. Try reopening the app.");
    });

    const interval = setInterval(() => {
      setLiveNow(Date.now());
      getBusinessMileageSummary()
        .then((next) => {
          if (mounted) {
            setMileageSummary(next);
          }
        })
        .catch(() => {
          if (mounted) {
            setActionMessage("Mileage tracking summary is temporarily unavailable.");
          }
        });
    }, 1_000);

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
    if (session.mode !== "online") {
      return;
    }

    let active = true;

    const refreshAreaLabel = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          const requested = await Location.requestForegroundPermissionsAsync();
          if (requested.status !== "granted") {
            if (active) {
              setActionMessage("Location permission is needed for live area labels while online.");
            }
            return;
          }
        }

        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const label = await deriveAreaLabel(position.coords.latitude, position.coords.longitude);

        if (!active || !label) {
          return;
        }

        if (label !== session.currentAreaLabel) {
          await setCurrentAreaLabel(label);
          if (!active) {
            return;
          }
          setSession((prev) => ({ ...prev, currentAreaLabel: label }));
        }
      } catch {
        if (active) {
          setActionMessage("We couldn't refresh your live area just now.");
        }
      }
    };

    refreshAreaLabel();
    const interval = setInterval(refreshAreaLabel, 60_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [session.currentAreaLabel, session.mode]);

  const onToggleSession = async () => {
    setActionMessage(null);

    if (session.mode === "offline") {
      if (startPoints.length === 0) {
        setGoOnlineDecision({
          state: "unavailable",
          decision: null,
          userFacingDecisionLabel: "Reminder",
          headline: "Add favourites",
          rationale: "Don't forget to set your favourites - you can always change these later.",
          evidenceLabel: "No evidence",
          evidenceDetail: "No saved favourites available for comparison yet.",
          basisWindowDays: 90,
          fallbackMessage: "Add at least one favourite in Settings first.",
        });
      }

      const chosenArea = startPoints[0]?.outwardCode ?? startPoints[0]?.postcode ?? session.currentAreaLabel ?? null;
      try {
        const next = await setSessionMode("online", chosenArea);
        setSession(next);

        const tracking = await startBusinessMileageTracking(chosenArea);
        setMileageSummary(tracking.summary);
        if (!tracking.ok && tracking.warning) {
          setActionMessage(tracking.warning);
        }
      } catch {
        setActionMessage("Couldn't go online right now. Please try again.");
      }
      return;
    }

    try {
      const tracking = await stopBusinessMileageTracking(session.currentAreaLabel);
      const next = await setSessionMode("offline", session.currentAreaLabel);
      setSession(next);
      setMileageSummary(tracking.summary);
      setGoOnlineDecision(null);
    } catch {
      setActionMessage("Couldn't switch offline right now. Please try again.");
    }
  };

  const onShouldGoOnlineNow = async () => {
    setActionMessage(null);
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
    try {
      await completeOutstandingAction(actionId);
      const refreshed = await getOutstandingActions({
        hasNewAchievements: newAchievementResult.hasNewAchievements,
        latestImportToken,
      });
      setOutstandingActions(refreshed);
    } catch {
      setActionMessage("Couldn't update this action right now.");
    }
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

  const userFacingAction = mapDecisionLabel(rec.action);
  const currentOnlineSeconds =
    session.mode === "online" && session.trackingStartedAt
      ? session.accumulatedOnlineSeconds + Math.max(0, Math.floor((liveNow - new Date(session.trackingStartedAt).getTime()) / 1000))
      : session.accumulatedOnlineSeconds;

  return (
    <ScreenShell title="Dashboard" subtitle="Decision-first co-pilot built on imported history and local controls.">
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
          <Text style={styles.statusText}>{session.mode === "online" ? `Online - ${session.currentAreaLabel ?? "Locating area"}` : "Offline"}</Text>
        </Pressable>
        <Text style={styles.statusHint}>{session.mode === "online" ? "Tap to go offline" : "Tap to go online"}</Text>
        {session.mode === "offline" ? <Text style={styles.statusHint}>Mileage tracking inactive in offline mode</Text> : null}
        {actionMessage ? <Text style={styles.statusMessage}>{actionMessage}</Text> : null}
      </Card>

      {session.mode === "online" ? (
        <>
          <Card title="Current Location Context">
            <Text>
              {session.currentAreaLabel
                ? `${session.currentAreaLabel} is your live working area label.`
                : "Location is available while online once GPS resolves your current area."}
            </Text>
          </Card>

          <Card title="Recommended Action">
            <Text style={styles.decisionHeadline}>{userFacingAction}</Text>
            <ConfidenceBadge
              evidenceLabel={evidenceLabelFromConfidence(rec.confidence)}
              evidenceDetail={evidenceDetailFromSample(rec.sampleSize, "similar periods")}
            />
            <Text>{`Basis: ${rec.basisWindow.label}`}</Text>
            <Text>{placeholderOnlineGuidance.areaStrength}</Text>
            <Text>{placeholderOnlineGuidance.shiftHint}</Text>
            <Text>{placeholderOnlineGuidance.nearbyAlternative}</Text>
          </Card>

          <Card title="What Usually Happens Here?">
            <KeyValueRow label="Average wait here" value={`${placeholderBeenHereBefore.averageWaitMinutes.toFixed(1)} mins`} />
            <KeyValueRow label="Average trip value" value={formatGBP(placeholderBeenHereBefore.averageFirstFare)} />
            <KeyValueRow
              label="Typical 60 / 90 min outcome after starting here"
              value={`${formatGBP(placeholderBeenHereBefore.likelyOutcome60Minutes)} / ${formatGBP(placeholderBeenHereBefore.likelyOutcome90Minutes)}`}
            />
            <KeyValueRow label="Chance of another trip within 30 min" value={formatPercent(placeholderBeenHereBefore.followOnRate)} />
            <KeyValueRow label="Most common next job type" value={placeholderUsuallyNext.likelyNextJobType} />
          </Card>

          <Card title="Business Mileage Tracking">
            <KeyValueRow label="Tracking status" value={mileageSummary.active ? "Active" : "Paused"} />
            <KeyValueRow label="Tracked business miles" value={formatMiles(mileageSummary.trackedBusinessMiles)} />
            <KeyValueRow label="Driver Toolkit online session time" value={formatDurationClock(currentOnlineSeconds)} />
            <Text>GPS mileage tracking runs only while online.</Text>
          </Card>

          <Card title="Quick Actions">
            <View style={styles.quickActionsRow}>
              <PrimaryButton label="Upload expense" onPress={() => router.push("/reports")} />
              <PrimaryButton label="Add cash expense" onPress={() => router.push("/reports")} />
            </View>
          </Card>
        </>
      ) : (
        <>
          <Card title="Should I Go Online Now?">
            <Text>Tap to compare nearby favourites using historical performance at this time.</Text>
            <PrimaryButton label="Should I go online now?" onPress={onShouldGoOnlineNow} />
            {goOnlineDecision ? (
              <View style={{ marginTop: 8, gap: 4 }}>
                <Text style={{ fontWeight: "700" }}>{goOnlineDecision.headline}</Text>
                <Text>{goOnlineDecision.rationale}</Text>
                {goOnlineDecision.state === "decision" ? <Text>{goOnlineDecision.userFacingDecisionLabel}</Text> : null}
                <ConfidenceBadge evidenceLabel={goOnlineDecision.evidenceLabel} evidenceDetail={goOnlineDecision.evidenceDetail} />
                {goOnlineDecision.comparedAreaLabel ? (
                  <Text>{`Alternative: ${goOnlineDecision.comparedAreaLabel} (${goOnlineDecision.comparedAreaDistanceMiles?.toFixed(1)} miles)`}</Text>
                ) : null}
              </View>
            ) : null}
          </Card>

          {upcomingWarnings.length > 0 || setupReminders.length > 0 ? (
            <Card title="Reminders">
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
                <Text>You're all caught up.</Text>
              </View>
            ) : null}
          </Card>

          <Card title="Tax Progress">
            <KeyValueRow label="Tax savings" value={formatGBP(taxSavings)} />
            <KeyValueRow label="Estimated liability" value={formatGBP(estimatedLiability)} />
            <KeyValueRow label="Progress" value={formatPercent(taxProgressRatio)} />
            <KeyValueRow label="Remaining gap" value={formatGBP(Math.max(estimatedLiability - taxSavings, 0))} />
            <KeyValueRow label="Tax data correct to" value={formatUkDate(settings?.taxCorrectToDate)} />
          </Card>

          <Card title="Achievement Highlight">
            <Text>{offlineHighlight.title}</Text>
            <Text>{offlineHighlight.metricValue}</Text>
            <Text>{`When: ${formatUkDateTime(offlineHighlight.occurredAt)}`}</Text>
            <Text>{offlineHighlight.oneLineExplanation}</Text>
            {newAchievementResult.hasNewAchievements ? <Text>{`New since upload: ${newAchievementResult.events[0].headline}`}</Text> : null}
          </Card>

          <Card title="Quick Actions">
            <View style={styles.quickActionsRow}>
              <PrimaryButton label="Upload expense" onPress={() => router.push("/reports")} />
              <PrimaryButton label="Add cash expense" onPress={() => router.push("/reports")} />
            </View>
          </Card>
        </>
      )}
    </ScreenShell>
  );
}

async function deriveAreaLabel(latitude: number, longitude: number): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    const first = results[0];

    if (!first) {
      return null;
    }

    const outward = deriveUkOutwardCode(first.postalCode ?? "");
    if (outward) {
      return outward;
    }

    if (first.city) {
      return first.city;
    }

    if (first.subregion) {
      return first.subregion;
    }

    return "Area available";
  } catch {
    return null;
  }
}

function mapDecisionLabel(action: "stay" | "reposition" | "avoid" | "short-wait-only"): string {
  if (action === "stay") {
    return "Stay here";
  }
  if (action === "reposition") {
    return "Reposition";
  }
  if (action === "avoid") {
    return "Work, but not here";
  }
  return "Short wait only";
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
  statusMessage: {
    marginTop: 8,
    color: "#7a382f",
  },
  decisionHeadline: {
    fontWeight: "700",
    fontSize: 22,
  },
  quickActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
