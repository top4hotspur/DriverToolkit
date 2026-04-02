import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { GoOnlineNowDecisionContract } from "../contracts/goOnlineNow";
import { OfflineAction } from "../contracts/tasks";
import { BusinessMileageSummary } from "../contracts/tracking";
import { ProximityAlertResult, TrackedPlace } from "../contracts/advisory";
import {
  buildTrackedPlacesFromFavourites,
  evaluateProximityAlert,
} from "../engines/advisory/proximityAlerts";
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
  placeholderUsuallyNext,
} from "../presentation/placeholderData";
import { getOfflineContextualAchievementHighlight } from "../presentation/placeholderAchievements";
import { getCaughtUpState } from "../presentation/offlineTasks";
import { buildRecommendedActionTemplate } from "../presentation/recommendedActionCopy";
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
  const areaAttemptsRef = useRef(0);
  const alertPulse = useRef(new Animated.Value(0)).current;
  const latestAreaLabelRef = useRef<string | null>(null);
  const previousAlertSignatureRef = useRef<string>("none");

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
  const [isToggling, setIsToggling] = useState(false);
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const [areaResolutionAttempts, setAreaResolutionAttempts] = useState(0);
  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [trackedPlaces, setTrackedPlaces] = useState<TrackedPlace[]>([]);
  const [proximityAlert, setProximityAlert] = useState<ProximityAlertResult>({
    state: "none",
    headline: "Nothing notable around you",
    details: "No nearby monitored places are currently available for advisory checks.",
    confidence: "LOW",
    basisLabel: "Monitored place advisory (next 60 minutes)",
    evaluatedAt: new Date().toISOString(),
  });

  const refreshCanonicalState = useCallback(
    async (options?: { suppressError?: boolean }) => {
      try {
        const [nextSession, nextMileage] = await Promise.all([getSessionState(), getBusinessMileageSummary()]);
        logLocation("canonical-refresh-loaded", {
          mode: nextSession.mode,
          currentAreaLabel: nextSession.currentAreaLabel,
          trackingStartedAt: nextSession.trackingStartedAt,
          trackingStoppedAt: nextSession.trackingStoppedAt,
          businessMileageTrackingEnabled: nextSession.businessMileageTrackingEnabled,
          accumulatedOnlineSeconds: nextSession.accumulatedOnlineSeconds,
        });
        setSession(nextSession);
        if (nextSession.currentAreaLabel) {
          latestAreaLabelRef.current = nextSession.currentAreaLabel;
        }
        setMileageSummary(nextMileage);
        logLocation("canonical-refresh", {
          mode: nextSession.mode,
          area: nextSession.currentAreaLabel,
          trackingActive: nextMileage.active,
        });
      } catch {
        if (!options?.suppressError) {
          setActionMessage("Couldn't refresh session state right now.");
        }
      }
    },
    [],
  );

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
      const [loadedSettings, latestImport, points] = await Promise.all([
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

      await refreshCanonicalState({ suppressError: true });
      setSettings(loadedSettings);
      setStartPoints(points);
      setTrackedPlaces(buildTrackedPlacesFromFavourites(points));
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
    }, 1_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [refreshCanonicalState]);

  useEffect(() => {
    setTrackedPlaces(buildTrackedPlacesFromFavourites(startPoints));
  }, [startPoints]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isToggling) {
        refreshCanonicalState({ suppressError: true }).catch(() => {
          // Keep polling silent unless an action explicitly fails.
        });
      }
    }, 15_000);

    return () => clearInterval(interval);
  }, [isToggling, refreshCanonicalState]);

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
    if (session.currentAreaLabel) {
      latestAreaLabelRef.current = session.currentAreaLabel;
    }
    logLocation("render-state-snapshot", {
      mode: session.mode,
      currentAreaLabel: session.currentAreaLabel,
      latestAreaLabel: latestAreaLabelRef.current,
    });
  }, [session.currentAreaLabel, session.mode]);

  useEffect(() => {
    if (session.mode !== "online") {
      setAreaResolutionAttempts(0);
      areaAttemptsRef.current = 0;
      setProximityAlert({
        state: "none",
        headline: "Nothing notable to share",
        details: "No nearby monitored places are currently available for advisory checks.",
        confidence: "LOW",
        basisLabel: "Monitored place advisory (next 60 minutes)",
        evaluatedAt: new Date().toISOString(),
      });
      return;
    }

    let active = true;

    const refreshAreaLabel = async () => {
      try {
        logLocation("refresh-start", { mode: session.mode });
        const permission = await Location.getForegroundPermissionsAsync();
        logLocation("permission-check", { status: permission.status });
        if (permission.status !== "granted") {
          const requested = await Location.requestForegroundPermissionsAsync();
          logLocation("permission-request", { status: requested.status });
          if (requested.status !== "granted") {
            if (active) {
              areaAttemptsRef.current += 1;
              setAreaResolutionAttempts(areaAttemptsRef.current);
              if (areaAttemptsRef.current >= 2) {
                setActionMessage("Location permission is needed for live area labels while online.");
              }
            }
            return;
          }
        }

        const position =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (!position) {
          logLocation("coords-missing", {});
          if (active) {
            areaAttemptsRef.current += 1;
            setAreaResolutionAttempts(areaAttemptsRef.current);
            if (areaAttemptsRef.current >= 3) {
              setActionMessage("Still resolving your live area. Keep moving for a clearer GPS fix.");
            }
          }
          return;
        }

        logLocation("coords-received", {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setCurrentCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        const label = await deriveAreaLabel(position.coords.latitude, position.coords.longitude);
        logLocation("reverse-geocode-label", { label });

        if (!active || !label) {
          if (active) {
            areaAttemptsRef.current += 1;
            setAreaResolutionAttempts(areaAttemptsRef.current);
            if (areaAttemptsRef.current >= 3) {
              setActionMessage("Still resolving your live area. Keep moving for a clearer GPS fix.");
            }
          }
          return;
        }

        logLocation("compare-before-persist", {
          incomingLabel: label,
          existingLabel: latestAreaLabelRef.current,
        });

        latestAreaLabelRef.current = label;
        logLocation("live-area-applied", {
          resolvedLabel: label,
          persistedBeforeWrite: session.currentAreaLabel,
        });

        logLocation("persist-before", { label });
        await setCurrentAreaLabel(label);
        logLocation("persist-after", { label });
        if (!active) {
          return;
        }
        await refreshCanonicalState({ suppressError: true });
        logLocation("refresh-after-persist", { label });
        areaAttemptsRef.current = 0;
        setAreaResolutionAttempts(0);
        setActionMessage((previous) =>
          previous?.startsWith("Still resolving") ? null : previous,
        );
      } catch {
        if (active) {
          areaAttemptsRef.current += 1;
          setAreaResolutionAttempts(areaAttemptsRef.current);
          if (areaAttemptsRef.current >= 3) {
            setActionMessage("We couldn't refresh your live area just now.");
          }
        }
      }
    };

    refreshAreaLabel();
    const interval = setInterval(refreshAreaLabel, 60_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [refreshCanonicalState, session.currentAreaLabel, session.mode]);

  useEffect(() => {
    if (session.mode !== "online") {
      return;
    }

    const evaluate = () => {
      const next = evaluateProximityAlert({
        now: new Date(),
        currentCoords,
        trackedPlaces,
        radiusMiles: 5,
      });
      setProximityAlert(next);
    };

    evaluate();
    const interval = setInterval(evaluate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentCoords, session.mode, trackedPlaces]);

  useEffect(() => {
    const signature = `${proximityAlert.state}|${proximityAlert.headline}|${proximityAlert.details}`;
    const previous = previousAlertSignatureRef.current;
    previousAlertSignatureRef.current = signature;

    const shouldPulse =
      proximityAlert.state === "alert" &&
      previous !== "none" &&
      signature !== previous;

    if (!shouldPulse) {
      alertPulse.setValue(0);
      return;
    }

    Animated.sequence([
      Animated.timing(alertPulse, { toValue: 1, duration: 260, useNativeDriver: false }),
      Animated.timing(alertPulse, { toValue: 0, duration: 320, useNativeDriver: false }),
    ]).start();
  }, [alertPulse, proximityAlert.details, proximityAlert.headline, proximityAlert.state]);

  const onToggleSession = async () => {
    if (isToggling) {
      return;
    }

    setIsToggling(true);
    setActionMessage(null);
    const nowIso = new Date().toISOString();

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
      logLocation("toggle-online-before-persist", {
        chosenArea,
        mode: session.mode,
        currentAreaLabel: session.currentAreaLabel,
      });

      try {
        const persistedOnline = await setSessionMode("online", chosenArea);
        logLocation("toggle-online-after-persist", {
          mode: persistedOnline.mode,
          currentAreaLabel: persistedOnline.currentAreaLabel,
          trackingStartedAt: persistedOnline.trackingStartedAt,
        });
        setSession(persistedOnline);

        const tracking = await startBusinessMileageTracking(chosenArea);
        logLocation("toggle-online-tracking-result", {
          ok: tracking.ok,
          warning: tracking.warning ?? null,
        });
        if (!tracking.ok && tracking.warning) {
          await rollbackToOffline({
            reason: "tracking-start-failed",
            areaLabel: chosenArea,
            userMessage: "Couldn't start online tracking. Stayed offline.",
          });
          return;
        }
        await refreshCanonicalState({ suppressError: true });
        if (tracking.ok) {
          setActionMessage(null);
        }
      } catch (error) {
        await rollbackToOffline({
          reason: "online-transition-catch",
          areaLabel: chosenArea,
          userMessage: "Couldn't go online right now. Please try again.",
          error: error instanceof Error ? error.message : "unknown error",
        });
      } finally {
        setIsToggling(false);
      }
      return;
    }

    logLocation("toggle-offline-before-persist", {
      mode: session.mode,
      currentAreaLabel: session.currentAreaLabel,
      nowIso,
    });

    try {
      const persistedOffline = await setSessionMode("offline", session.currentAreaLabel);
      logLocation("toggle-offline-after-persist", {
        mode: persistedOffline.mode,
        currentAreaLabel: persistedOffline.currentAreaLabel,
        trackingStoppedAt: persistedOffline.trackingStoppedAt,
      });
      await stopBusinessMileageTracking(session.currentAreaLabel);
      await refreshCanonicalState({ suppressError: true });
      setGoOnlineDecision(null);
    } catch {
      await refreshCanonicalState({ suppressError: true });
      setActionMessage("Couldn't switch offline right now. Please try again.");
    } finally {
      setIsToggling(false);
    }
  };

  const rollbackToOffline = async (args: {
    reason: string;
    areaLabel: string | null;
    userMessage: string;
    error?: string;
  }) => {
    logLocation("rollback-offline-triggered", {
      reason: args.reason,
      areaLabel: args.areaLabel,
      error: args.error ?? null,
    });
    await setSessionMode("offline", args.areaLabel).catch(() => {
      logLocation("rollback-offline-persist-failed", {
        reason: args.reason,
      });
    });
    await stopBusinessMileageTracking(args.areaLabel).catch(() => {
      logLocation("rollback-offline-stop-tracking-failed", {
        reason: args.reason,
      });
    });
    await refreshCanonicalState({ suppressError: true });
    setActionMessage(args.userMessage);
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
  const renderedAreaLabel = session.currentAreaLabel;
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
  const recommendedTemplate = buildRecommendedActionTemplate({
    recommendation: rec,
    favouriteOrAreaLabel: startPoints[0]?.outwardCode ?? "BT7",
    hasNearbyAlternative: startPoints.length > 0,
  });
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
          <Text style={styles.statusText}>
            {session.mode === "online"
              ? `Online - ${renderedAreaLabel ?? "Locating area"}`
              : "Offline"}
          </Text>
        </Pressable>
        <Text style={styles.statusHint}>{session.mode === "online" ? "Tap to go offline" : "Tap to go online"}</Text>
        {session.mode === "offline" ? <Text style={styles.statusHint}>Mileage tracking inactive in offline mode</Text> : null}
        {isToggling ? <Text style={styles.statusHint}>Updating session...</Text> : null}
        {actionMessage ? <Text style={styles.statusMessage}>{actionMessage}</Text> : null}
      </Card>

      {session.mode === "online" ? (
        <>
          <Card title="Current Location">
            <KeyValueRow label="Current area" value={renderedAreaLabel ?? "Locating area"} />
            <Text style={styles.decisionHeadline}>{userFacingAction}</Text>
            <ConfidenceBadge
              evidenceLabel={evidenceLabelFromConfidence(rec.confidence)}
              evidenceDetail={evidenceDetailFromSample(rec.sampleSize, "similar periods")}
            />
            <Text>{`Basis: ${rec.basisWindow.label}`}</Text>
            <Text>{renderHighlightedTemplate(recommendedTemplate.areaStrength)}</Text>
            <Text>{renderHighlightedTemplate(recommendedTemplate.stayGuidance)}</Text>
            <Text>{renderHighlightedTemplate(recommendedTemplate.nearbyGuidance)}</Text>
          </Card>

          <Animated.View
            style={[
              styles.proximityAnimatedWrap,
              {
                backgroundColor: alertPulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["rgba(30,111,80,0)", "rgba(30,111,80,0.14)"],
                }),
              },
            ]}
          >
            <Card title="Proximity Alert">
            <Text style={styles.proximityHeadline}>{proximityAlert.headline}</Text>
            <Text>{proximityAlert.details}</Text>
            <KeyValueRow label="Monitoring radius" value="5 miles" />
            <KeyValueRow label="Last checked" value={formatUkDateTime(proximityAlert.evaluatedAt)} />
            </Card>
          </Animated.View>

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
            <KeyValueRow label="Tracking status" value={mileageSummary.active ? "Active" : "Starting"} />
            <KeyValueRow label="Tracked business miles" value={formatMiles(mileageSummary.trackedBusinessMiles)} />
            <KeyValueRow label="Driver Toolkit online session time" value={formatDurationClock(currentOnlineSeconds)} />
            <Text>GPS mileage tracking runs only while online.</Text>
          </Card>

          <Card title="Quick Actions">
            <View style={styles.quickActionsRow}>
              <PrimaryButton label="Upload expense" onPress={() => router.push("/expenses/upload")} />
              <PrimaryButton label="Add cash expense" onPress={() => router.push("/expenses/cash")} />
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
              <PrimaryButton label="Upload expense" onPress={() => router.push("/expenses/upload")} />
              <PrimaryButton label="Add cash expense" onPress={() => router.push("/expenses/cash")} />
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

function renderHighlightedTemplate(template: string) {
  const pieces = template.split("**");
  return pieces.map((piece, index) => (
    <Text key={`${piece}-${index}`} style={index % 2 === 1 ? styles.highlightKeyword : undefined}>
      {piece}
    </Text>
  ));
}

function logLocation(event: string, payload: Record<string, unknown>): void {
  console.log(`[DT][location] ${event}`, payload);
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
  proximityHeadline: {
    fontWeight: "700",
    fontSize: 16,
  },
  proximityAnimatedWrap: {
    borderRadius: 14,
  },
  highlightKeyword: {
    fontWeight: "700",
    color: "#214e3f",
  },
  quickActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
