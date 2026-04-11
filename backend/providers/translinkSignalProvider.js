const { listTranslinkTrackedHubs } = require("../translinkTrackedHubs");
const { toNormalizedSignal } = require("../signalModel");

function createTranslinkSignalProvider(options) {
  const { translinkRail, adminConfig } = options;

  async function collectSignals(args = {}) {
    const now = args.now ? new Date(args.now) : new Date();
    const config = adminConfig.get();
    const providerEnabled = config.providers?.translink?.enabled === true;
    if (!providerEnabled) {
      return {
        generatedAt: now.toISOString(),
        signals: [],
        trackedHubs: listTranslinkTrackedHubs(),
      };
    }

    const busyMultiplier = Number(config.translink?.busyMultiplier ?? 1.1);
    const veryBusyMultiplier = Number(config.translink?.veryBusyMultiplier ?? 1.5);
    const proximityRadiusMiles = Number(config.translink?.defaultProximityRadiusMiles ?? 5);
    const enabledHubKeys = Array.isArray(config.translink?.trackedHubKeys)
      ? config.translink.trackedHubKeys.map((value) => String(value))
      : [];
    const trackedHubs = listTranslinkTrackedHubs().filter((hub) =>
      enabledHubKeys.length > 0 ? enabledHubKeys.includes(hub.hubKey) : true,
    );

    if (args.mode === "diary" && typeof args.date === "string" && args.date.trim().length > 0) {
      return await buildSelectedDayPlannerSignals({
        dateKey: args.date.trim(),
        trackedHubs,
        busyMultiplier,
        veryBusyMultiplier,
        regionKey: args.regionKey,
      });
    }

    const rawByHub = await Promise.all(
      trackedHubs.map(async (hub) => {
        const raw = await translinkRail.getSmartDiarySignalForHub(hub.hubKey, {
          latitude: args.lat,
          longitude: args.lng,
        });
        return { hub, raw };
      }),
    );

    const signals = [];
    for (const { hub, raw } of rawByHub) {
      if (!raw) continue;
      const baseline = Number(raw.baselineCount ?? 0);
      const current = Number(raw.nextHourExpectedArrivalsCount ?? 0);
      const alerts = Array.isArray(raw.alertItems) ? raw.alertItems : [];
      const nextEvents = Array.isArray(raw.nextEvents) ? raw.nextEvents : [];
      const transportDiagnostics =
        (raw.notes?.diagnostics && typeof raw.notes.diagnostics === "object"
          ? raw.notes.diagnostics
          : null) ??
        {};
      const arrivalsAvailability = String(
        raw.notes?.arrivalsAvailability ?? "departure_monitor_as_closest_arrivals_equivalent",
      );
      const normalizedEvents = nextEvents.slice(0, 10).map((event) => ({
        mode: event.mode ?? "train",
        origin: event.origin ?? hub.displayName,
        destination: event.destination ?? null,
        scheduledTime: event.timeLabel ?? null,
        scheduledTimeIso: event.timeIso ?? null,
        sourceType: event.isFallback === true ? "fallback" : "live",
        sourceKey: event.sourceKey ?? null,
        cancelled: event.cancelled === true,
        delayed:
          event.delayed === true ||
          String(event.disruptionType ?? "").toLowerCase() === "delayed" ||
          String(event.disruptionText ?? "").toLowerCase().includes("delay"),
        disruptionType: event.disruptionType ?? null,
        disruptionText: event.disruptionText ?? null,
        status: resolveTransportEventStatus(event),
      }));
      const eventCountLive = normalizedEvents.filter((event) => event.sourceType === "live").length;
      const eventCountFallback = normalizedEvents.filter((event) => event.sourceType === "fallback").length;
      const surfacedDetailMode =
        normalizedEvents.length > 0
          ? eventCountLive > 0
            ? "live"
            : "fallback"
          : "none";
      const eventsForUi = normalizedEvents;
      const delayedOrCancelledCount = normalizedEvents.filter(
        (event) =>
          event.cancelled ||
          event.delayed ||
          String(event.disruptionType ?? "").toLowerCase() === "replacement_bus" ||
          String(event.disruptionType ?? "").toLowerCase() === "disrupted",
      ).length;
      const surfacedDetailCount = normalizedEvents.length;
      const surfacedCountsByMode = countTransportEventsByMode(normalizedEvents);
      const disruptionTypes = Array.from(
        new Set(
          normalizedEvents
            .map((event) => String(event.disruptionType ?? "").trim())
            .filter(Boolean),
        ),
      );
      const affectedModes = Array.from(
        new Set(
          normalizedEvents
            .filter(
              (event) =>
                event.cancelled ||
                event.delayed ||
                String(event.disruptionType ?? "").trim().length > 0,
            )
            .map((event) => String(event.mode ?? "train")),
        ),
      );
      const disruptionCount = Number(transportDiagnostics.disruptionCount ?? alerts.length ?? 0);
      const hasLiveRows = Boolean(
        transportDiagnostics.hasLiveRows ??
          normalizedEvents.some((event) => event.sourceType === "live"),
      );
      const hasFallbackRows = Boolean(
        transportDiagnostics.hasFallbackRows ??
          normalizedEvents.some((event) => event.sourceType === "fallback"),
      );
      const railRawCount = Number(transportDiagnostics.railRawCount ?? 0);
      const busRawCount = Number(transportDiagnostics.busRawCount ?? 0);
      const railNormalizedCount = Number(
        transportDiagnostics.railNormalizedCount ?? surfacedCountsByMode.train,
      );
      const busNormalizedCount = Number(
        transportDiagnostics.busNormalizedCount ?? surfacedCountsByMode.bus,
      );
      const surfacedRailCount = Number(
        transportDiagnostics.surfacedRailCount ?? surfacedCountsByMode.train,
      );
      const surfacedBusCount = Number(
        transportDiagnostics.surfacedBusCount ?? surfacedCountsByMode.bus,
      );
      console.log(
        `[TRANSPORT][detail] hub=${hub.hubKey} railRawCount=${railRawCount} busRawCount=${busRawCount} railNormalizedCount=${railNormalizedCount} busNormalizedCount=${busNormalizedCount} surfacedRailCount=${surfacedRailCount} surfacedBusCount=${surfacedBusCount} surfacedDetailMode=${surfacedDetailMode}`,
      );
      console.log(
        `[TRANSPORT][disruption] hub=${hub.hubKey} disruptionCount=${disruptionCount} disruptionTypes=${(disruptionTypes.length > 0 ? disruptionTypes : Array.isArray(transportDiagnostics.disruptionTypes) ? transportDiagnostics.disruptionTypes : []).join("|") || "none"} affectedModes=${(affectedModes.length > 0 ? affectedModes : Array.isArray(transportDiagnostics.affectedModes) ? transportDiagnostics.affectedModes : []).join("|") || "none"}`,
      );
      const busyThreshold = baseline > 0 ? baseline * busyMultiplier : 1;
      const veryBusyThreshold = baseline > 0 ? baseline * veryBusyMultiplier : 2;
      const isVeryBusy = current >= veryBusyThreshold;
      const isBusy = !isVeryBusy && current > busyThreshold;
      const startsAt = now.toISOString();
      const endsAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

      if (isVeryBusy) {
        const upliftVsBaseline = Number((current - baseline).toFixed(2));
        signals.push(
          toNormalizedSignal({
            id: `translink:${hub.hubKey}:transport_very_busy:${startsAt}`,
            providerKey: "translink",
            regionKey: hub.regionKey,
            signalType: "transport_very_busy",
            title: `${hub.displayName} very busy`,
            subtitle: "Significantly higher than average arrivals expected",
            description: `${current} arrivals expected vs baseline ${baseline.toFixed(1)} in next hour.`,
            severity: "critical",
            startsAt,
            endsAt,
            location: hubLocation(hub),
            metadata: {
              isBaseline: true,
              isLiveException: false,
              baselineReference: `${hub.hubKey}:weekday_hour`,
              baselineAverage: baseline,
              currentExpected: current,
              upliftVsBaseline,
              baseline,
              current,
              busyThreshold,
              veryBusyThreshold,
              delayedOrCancelledCount,
              events: eventsForUi,
              arrivalsAvailability,
              eventCountLive,
              eventCountFallback,
              surfacedDetailCount,
              surfacedDetailMode,
              railRawCount,
              busRawCount,
              railNormalizedCount,
              busNormalizedCount,
              surfacedRailCount,
              surfacedBusCount,
              hasLiveRows,
              hasFallbackRows,
              disruptionCount,
              disruptionTypes:
                disruptionTypes.length > 0
                  ? disruptionTypes
                  : Array.isArray(transportDiagnostics.disruptionTypes)
                    ? transportDiagnostics.disruptionTypes
                    : [],
              affectedModes:
                affectedModes.length > 0
                  ? affectedModes
                  : Array.isArray(transportDiagnostics.affectedModes)
                    ? transportDiagnostics.affectedModes
                    : [],
              arrivalsAvailability:
                transportDiagnostics.arrivalsAvailability ?? arrivalsAvailability,
              modeCounts: raw.modeCounts ?? { train: 0, bus: 0 },
              sourceRefs: raw.currentHub?.sourceRefs ?? raw.notes?.sourceRefs ?? [],
            },
          }),
        );
      } else if (isBusy) {
        const upliftVsBaseline = Number((current - baseline).toFixed(2));
        signals.push(
          toNormalizedSignal({
            id: `translink:${hub.hubKey}:transport_busy:${startsAt}`,
            providerKey: "translink",
            regionKey: hub.regionKey,
            signalType: "transport_busy",
            title: `${hub.displayName} busy`,
            subtitle: "Higher than average arrivals expected",
            description: `${current} arrivals expected vs baseline ${baseline.toFixed(1)} in next hour.`,
            severity: "warning",
            startsAt,
            endsAt,
            location: hubLocation(hub),
            metadata: {
              isBaseline: true,
              isLiveException: false,
              baselineReference: `${hub.hubKey}:weekday_hour`,
              baselineAverage: baseline,
              currentExpected: current,
              upliftVsBaseline,
              baseline,
              current,
              busyThreshold,
              veryBusyThreshold,
              delayedOrCancelledCount,
              events: eventsForUi,
              arrivalsAvailability,
              eventCountLive,
              eventCountFallback,
              surfacedDetailCount,
              surfacedDetailMode,
              railRawCount,
              busRawCount,
              railNormalizedCount,
              busNormalizedCount,
              surfacedRailCount,
              surfacedBusCount,
              hasLiveRows,
              hasFallbackRows,
              disruptionCount,
              disruptionTypes:
                disruptionTypes.length > 0
                  ? disruptionTypes
                  : Array.isArray(transportDiagnostics.disruptionTypes)
                    ? transportDiagnostics.disruptionTypes
                    : [],
              affectedModes:
                affectedModes.length > 0
                  ? affectedModes
                  : Array.isArray(transportDiagnostics.affectedModes)
                    ? transportDiagnostics.affectedModes
                    : [],
              arrivalsAvailability:
                transportDiagnostics.arrivalsAvailability ?? arrivalsAvailability,
              modeCounts: raw.modeCounts ?? { train: 0, bus: 0 },
              sourceRefs: raw.currentHub?.sourceRefs ?? raw.notes?.sourceRefs ?? [],
            },
          }),
        );
      } else {
        const upliftVsBaseline = Number((current - baseline).toFixed(2));
        signals.push(
          toNormalizedSignal({
            id: `translink:${hub.hubKey}:transport_normal:${startsAt}`,
            providerKey: "translink",
            regionKey: hub.regionKey,
            signalType: "transport_normal",
            title: `${hub.displayName} expected activity`,
            subtitle: "Arrivals tracking close to baseline",
            description: `${current} arrivals expected vs baseline ${baseline.toFixed(1)} in next hour.`,
            severity: "info",
            startsAt,
            endsAt,
            location: hubLocation(hub),
            metadata: {
              isBaseline: true,
              isLiveException: false,
              baselineReference: `${hub.hubKey}:weekday_hour`,
              baselineAverage: baseline,
              currentExpected: current,
              upliftVsBaseline,
              baselineStatus: "normal",
              busyThreshold,
              veryBusyThreshold,
              delayedOrCancelledCount,
              events: eventsForUi,
              arrivalsAvailability,
              eventCountLive,
              eventCountFallback,
              surfacedDetailCount,
              surfacedDetailMode,
              railRawCount,
              busRawCount,
              railNormalizedCount,
              busNormalizedCount,
              surfacedRailCount,
              surfacedBusCount,
              hasLiveRows,
              hasFallbackRows,
              disruptionCount,
              disruptionTypes:
                disruptionTypes.length > 0
                  ? disruptionTypes
                  : Array.isArray(transportDiagnostics.disruptionTypes)
                    ? transportDiagnostics.disruptionTypes
                    : [],
              affectedModes:
                affectedModes.length > 0
                  ? affectedModes
                  : Array.isArray(transportDiagnostics.affectedModes)
                    ? transportDiagnostics.affectedModes
                    : [],
              arrivalsAvailability:
                transportDiagnostics.arrivalsAvailability ?? arrivalsAvailability,
              modeCounts: raw.modeCounts ?? { train: 0, bus: 0 },
              sourceRefs: raw.currentHub?.sourceRefs ?? raw.notes?.sourceRefs ?? [],
            },
          }),
        );
      }

      const cancellations = alerts.filter((alert) =>
        String(alert.disruptionText ?? "").toLowerCase().includes("cancel"),
      );
      const disruptions = alerts.filter((alert) => !cancellations.includes(alert));

      for (const alert of cancellations) {
        const alertTime = alert.timeIso ? String(alert.timeIso) : startsAt;
        signals.push(
          toNormalizedSignal({
            id: `translink:${hub.hubKey}:cancellation:${alertTime}:${alert.destination ?? "service"}`,
            providerKey: "translink",
            regionKey: hub.regionKey,
            signalType: "cancellation",
            title: `${hub.displayName} cancellation`,
            subtitle: alert.destination
              ? `${alert.destination} service cancelled`
              : "Service cancellation detected",
            description: String(alert.disruptionText ?? "Cancellation detected"),
            severity: "critical",
            startsAt: alertTime,
            endsAt,
            location: hubLocation(hub),
            metadata: {
              isBaseline: false,
              isLiveException: true,
              baselineReference: `${hub.hubKey}:weekday_hour`,
              baselineAverage: baseline,
              currentExpected: current,
              upliftVsBaseline: Number((current - baseline).toFixed(2)),
              exceptionKind: "cancellation",
              destination: alert.destination ?? null,
              timeLabel: alert.timeLabel ?? null,
              delayedOrCancelledCount,
              events: eventsForUi,
              arrivalsAvailability,
              eventCountLive,
              eventCountFallback,
              surfacedDetailCount,
              surfacedDetailMode,
              railRawCount,
              busRawCount,
              railNormalizedCount,
              busNormalizedCount,
              surfacedRailCount,
              surfacedBusCount,
              hasLiveRows,
              hasFallbackRows,
              disruptionCount,
              disruptionTypes:
                disruptionTypes.length > 0
                  ? disruptionTypes
                  : Array.isArray(transportDiagnostics.disruptionTypes)
                    ? transportDiagnostics.disruptionTypes
                    : [],
              affectedModes:
                affectedModes.length > 0
                  ? affectedModes
                  : Array.isArray(transportDiagnostics.affectedModes)
                    ? transportDiagnostics.affectedModes
                    : [],
              arrivalsAvailability:
                transportDiagnostics.arrivalsAvailability ?? arrivalsAvailability,
              modeCounts: raw.modeCounts ?? { train: 0, bus: 0 },
              sourceRefs: raw.currentHub?.sourceRefs ?? raw.notes?.sourceRefs ?? [],
            },
          }),
        );
      }

      for (const alert of disruptions) {
        const alertTime = alert.timeIso ? String(alert.timeIso) : startsAt;
        signals.push(
          toNormalizedSignal({
            id: `translink:${hub.hubKey}:transport_disruption:${alertTime}:${alert.destination ?? "service"}`,
            providerKey: "translink",
            regionKey: hub.regionKey,
            signalType: "transport_disruption",
            title: `${hub.displayName} disruption`,
            subtitle: alert.destination
              ? `${alert.destination} service disruption`
              : "Service disruption detected",
            description: String(alert.disruptionText ?? "Disruption detected"),
            severity: "warning",
            startsAt: alertTime,
            endsAt,
            location: hubLocation(hub),
            metadata: {
              isBaseline: false,
              isLiveException: true,
              baselineReference: `${hub.hubKey}:weekday_hour`,
              baselineAverage: baseline,
              currentExpected: current,
              upliftVsBaseline: Number((current - baseline).toFixed(2)),
              exceptionKind: "disruption",
              destination: alert.destination ?? null,
              timeLabel: alert.timeLabel ?? null,
              delayedOrCancelledCount,
              events: eventsForUi,
              arrivalsAvailability,
              eventCountLive,
              eventCountFallback,
              surfacedDetailCount,
              surfacedDetailMode,
              railRawCount,
              busRawCount,
              railNormalizedCount,
              busNormalizedCount,
              surfacedRailCount,
              surfacedBusCount,
              hasLiveRows,
              hasFallbackRows,
              disruptionCount,
              disruptionTypes:
                disruptionTypes.length > 0
                  ? disruptionTypes
                  : Array.isArray(transportDiagnostics.disruptionTypes)
                    ? transportDiagnostics.disruptionTypes
                    : [],
              affectedModes:
                affectedModes.length > 0
                  ? affectedModes
                  : Array.isArray(transportDiagnostics.affectedModes)
                    ? transportDiagnostics.affectedModes
                    : [],
              arrivalsAvailability:
                transportDiagnostics.arrivalsAvailability ?? arrivalsAvailability,
              modeCounts: raw.modeCounts ?? { train: 0, bus: 0 },
              sourceRefs: raw.currentHub?.sourceRefs ?? raw.notes?.sourceRefs ?? [],
            },
          }),
        );
      }

      const proximity = raw.proximityTile ?? null;
      if (proximity?.isNearby) {
        signals.push(
          toNormalizedSignal({
            id: `translink:${hub.hubKey}:proximity_alert:${startsAt}`,
            providerKey: "translink",
            regionKey: hub.regionKey,
            signalType: "proximity_alert",
            title: `${hub.displayName} proximity`,
            subtitle: "Nearby hub activity in the next hour",
            description: `Within ~${proximityRadiusMiles.toFixed(1)} miles of ${hub.displayName}.`,
            severity:
              proximity.cancellationsInNextHour > 0 || raw.status === "very_busy"
                ? "critical"
                : raw.status === "busy"
                  ? "warning"
                  : "info",
            startsAt,
            endsAt,
            location: hubLocation(hub),
            metadata: {
              isBaseline: false,
              isLiveException: true,
              baselineReference: `${hub.hubKey}:weekday_hour`,
              baselineAverage: baseline,
              currentExpected: current,
              upliftVsBaseline: Number((current - baseline).toFixed(2)),
              exceptionKind:
                proximity.cancellationsInNextHour > 0
                  ? "cancellation_nearby"
                  : raw.status === "very_busy" || raw.status === "busy"
                    ? "uplift_vs_baseline"
                    : "nearby_upcoming",
              nextThree: raw.nextThree ?? [],
              cancellationsInNextHour: proximity.cancellationsInNextHour ?? 0,
              smartDiaryStatus: proximity.smartDiaryStatus ?? raw.status ?? "normal",
              proximityRadiusMiles,
              delayedOrCancelledCount,
              events: eventsForUi,
              arrivalsAvailability,
              eventCountLive,
              eventCountFallback,
              surfacedDetailCount,
              surfacedDetailMode,
              modeCounts: raw.modeCounts ?? { train: 0, bus: 0 },
              sourceRefs: raw.currentHub?.sourceRefs ?? raw.notes?.sourceRefs ?? [],
            },
          }),
        );
      }
    }

    return {
      generatedAt: now.toISOString(),
      signals,
      trackedHubs,
    };
  }

  async function buildSelectedDayPlannerSignals(args) {
    const date = parseDateKey(args.dateKey);
    const generatedAt = new Date().toISOString();
    if (!date) {
      return {
        generatedAt,
        signals: [],
        trackedHubs: args.trackedHubs,
        diaryDebug: {
          date: args.dateKey,
          totalWindowsEvaluated: 0,
          normalWindows: 0,
          busyWindows: 0,
          veryBusyWindows: 0,
          byHub: [],
          busyMultiplier: args.busyMultiplier,
          veryBusyMultiplier: args.veryBusyMultiplier,
          plannerMode: "selected_day_hourly_windows",
          invalidDate: true,
        },
      };
    }

    const dayShort = date
      .toLocaleDateString("en-GB", { weekday: "short" })
      .slice(0, 3);
    const today = new Date();
    const isToday = isSameLocalDate(date, today);
    const liveByHub = {};
    if (isToday) {
      const liveRows = await Promise.all(
        args.trackedHubs.map(async (hub) => ({
          hubKey: hub.hubKey,
          live: await translinkRail.getNextEventsForHub(hub.hubKey),
        })),
      );
      for (const row of liveRows) {
        liveByHub[row.hubKey] = row.live;
      }
    }
    const byHub = [];
    const signals = [];
    let normalWindows = 0;
    let busyWindows = 0;
    let veryBusyWindows = 0;

    for (const hub of args.trackedHubs) {
      const baseline = translinkRail.getBaselineForHub(hub.hubKey);
      const byWeekdayHour = baseline?.byWeekdayHour ?? {};
      const hubCounts = {
        hubKey: hub.hubKey,
        hubName: hub.displayName,
        windowsEvaluated: 24,
        normal: 0,
        busy: 0,
        veryBusy: 0,
      };

      for (let hour = 0; hour < 24; hour += 1) {
        const hourKey = `${dayShort}-${String(hour).padStart(2, "0")}`;
        const baselineAverage = toFiniteNumber(byWeekdayHour?.[hourKey]?.meanArrivals, 3);
        const scheduleMultiplier = getScheduleMultiplier(hub.hubKey, hour);
        const expectedArrivals = Math.max(
          0,
          Number((baselineAverage * scheduleMultiplier).toFixed(2)),
        );
        const busyThreshold = baselineAverage * args.busyMultiplier;
        const veryBusyThreshold = baselineAverage * args.veryBusyMultiplier;
        const classification =
          expectedArrivals >= veryBusyThreshold
            ? "transport_very_busy"
            : expectedArrivals > busyThreshold
              ? "transport_busy"
              : "transport_normal";
        const startAt = buildHourStart(date, hour);
        const endAt = buildHourStart(date, hour + 1);
        const liveHub = liveByHub[hub.hubKey] ?? null;
        const liveEvents =
          Array.isArray(liveHub?.nextEvents) && isToday && hour === today.getHours()
            ? liveHub.nextEvents
            : [];
        const normalizedLiveEvents = liveEvents.slice(0, 20).map((event) => ({
          mode: event.mode ?? "train",
          origin: event.origin ?? hub.displayName,
          destination: event.destination ?? null,
          scheduledTime: event.timeLabel ?? null,
          scheduledTimeIso: event.timeIso ?? null,
          cancelled: event.cancelled === true,
          delayed: String(event.disruptionText ?? "").toLowerCase().includes("delay"),
          status:
            event.cancelled === true
              ? "cancelled"
              : String(event.disruptionText ?? "").toLowerCase().includes("delay")
                ? "delayed"
                : "on_time",
        }));

        if (classification === "transport_very_busy") {
          veryBusyWindows += 1;
          hubCounts.veryBusy += 1;
        } else if (classification === "transport_busy") {
          busyWindows += 1;
          hubCounts.busy += 1;
        } else {
          normalWindows += 1;
          hubCounts.normal += 1;
        }

        signals.push(
          toNormalizedSignal({
            id: `translink:${hub.hubKey}:${classification}:${startAt.toISOString()}`,
            providerKey: "translink",
            regionKey: args.regionKey ?? hub.regionKey,
            signalType: classification,
            title:
              classification === "transport_very_busy"
                ? `${hub.displayName} very busy`
                : classification === "transport_busy"
                  ? `${hub.displayName} busy`
                  : `${hub.displayName} expected activity`,
            subtitle:
              classification === "transport_very_busy"
                ? "Significantly above average arrivals expected"
                : classification === "transport_busy"
                  ? "Above average arrivals expected"
                  : "Arrivals tracking close to baseline",
            description: `${formatHourWindow(startAt, endAt)} planned arrivals ${expectedArrivals.toFixed(
              1,
            )} vs baseline ${baselineAverage.toFixed(1)}.`,
            severity:
              classification === "transport_very_busy"
                ? "critical"
                : classification === "transport_busy"
                  ? "warning"
                  : "info",
            startsAt: startAt.toISOString(),
            endsAt: endAt.toISOString(),
            location: hubLocation(hub),
            metadata: {
              isBaseline: true,
              isLiveException: false,
              plannerMode: "selected_day_hourly_windows",
              baselineReference: `${hub.hubKey}:${hourKey}`,
              baselineAverage,
              currentExpected: expectedArrivals,
              upliftVsBaseline: Number((expectedArrivals - baselineAverage).toFixed(2)),
              busyThreshold: Number(busyThreshold.toFixed(2)),
              veryBusyThreshold: Number(veryBusyThreshold.toFixed(2)),
              scheduleMultiplier: Number(scheduleMultiplier.toFixed(3)),
              classification,
              hourKey,
              events: normalizedLiveEvents,
              modeCounts: liveHub?.modeCounts ?? { train: 0, bus: 0 },
              sourceRefs: liveHub?.sourceRefs ?? [],
            },
          }),
        );
      }

      byHub.push(hubCounts);
    }

    return {
      generatedAt,
      signals,
      trackedHubs: args.trackedHubs,
      diaryDebug: {
        date: args.dateKey,
        plannerMode: "selected_day_hourly_windows",
        totalWindowsEvaluated: args.trackedHubs.length * 24,
        normalWindows,
        busyWindows,
        veryBusyWindows,
        byHub,
        busyMultiplier: args.busyMultiplier,
        veryBusyMultiplier: args.veryBusyMultiplier,
      },
    };
  }

  return {
    providerKey: "translink",
    collectSignals,
    getTrackedHubs: listTranslinkTrackedHubs,
  };
}

function resolveTransportEventStatus(event) {
  if (event.cancelled === true || String(event.disruptionType ?? "").toLowerCase() === "cancelled") {
    return "cancelled";
  }
  if (String(event.disruptionType ?? "").toLowerCase() === "replacement_bus") {
    return "replacement bus";
  }
  if (
    event.delayed === true ||
    String(event.disruptionType ?? "").toLowerCase() === "delayed" ||
    String(event.disruptionText ?? "").toLowerCase().includes("delay")
  ) {
    return "delayed";
  }
  if (String(event.disruptionType ?? "").toLowerCase() === "disrupted") {
    return "disrupted";
  }
  return "on_time";
}

function countTransportEventsByMode(events) {
  return (Array.isArray(events) ? events : []).reduce(
    (acc, event) => {
      if (String(event.mode ?? "train").toLowerCase() === "bus") {
        acc.bus += 1;
      } else {
        acc.train += 1;
      }
      return acc;
    },
    { train: 0, bus: 0 },
  );
}

function isSameLocalDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function parseDateKey(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function buildHourStart(baseDate, hour) {
  const date = new Date(baseDate);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function formatHourWindow(startAt, endAt) {
  const start = `${String(startAt.getHours()).padStart(2, "0")}:00`;
  const end = `${String(endAt.getHours()).padStart(2, "0")}:00`;
  return `${start}-${end}`;
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getScheduleMultiplier(hubKey, hour) {
  const hubAdjustment =
    hubKey === "belfast_central"
      ? 1.08
      : hubKey === "great_victoria_street"
        ? 1.02
        : 0.95;
  const base =
    hour >= 7 && hour <= 9
      ? 1.55
      : hour >= 16 && hour <= 18
        ? 1.7
        : hour >= 12 && hour <= 14
          ? 1.25
          : hour >= 5 && hour <= 6
            ? 1.1
            : hour >= 20 && hour <= 22
              ? 0.95
              : hour >= 23 || hour <= 4
                ? 0.72
                : 1.0;
  return base * hubAdjustment;
}

function hubLocation(hub) {
  return {
    locationId: hub.hubKey,
    name: hub.displayName,
    postcode: hub.postcode ?? null,
    lat: hub.lat,
    lng: hub.lng,
    city: hub.city,
  };
}

module.exports = {
  createTranslinkSignalProvider,
};
