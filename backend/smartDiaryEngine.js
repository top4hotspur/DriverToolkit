const fs = require("fs");
const path = require("path");
const {
  listMvpLocations,
  normalizePostcode,
} = require("./smartDiaryRegistry");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampConfidence(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function makeBucketKey(date = new Date()) {
  const day = DAYS[date.getUTCDay()] ?? "Sun";
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${day}-${hour}`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function sanitizeDriverId(value) {
  return String(value ?? "")
    .trim()
    .slice(0, 120);
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lng2 - lng1) * p))) / 2;
  return 7917.5117 * Math.asin(Math.sqrt(a));
}

function inferImpactLevel(current, baseline, highMultiplier = 1.5, elevatedMultiplier = 1.1) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) {
    return "normal";
  }
  if (current >= baseline * highMultiplier) return "high";
  if (current > baseline * elevatedMultiplier) return "elevated";
  return "normal";
}

function getTimeWindowState(type, startTimeIso, endTimeIso, statusRaw, now = new Date()) {
  const startMs = Date.parse(startTimeIso ?? "");
  const defaultDurationMs = type === "concert" ? 3 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
  const endMsRaw = Date.parse(endTimeIso ?? "");
  const endMs = Number.isNaN(endMsRaw)
    ? Number.isNaN(startMs)
      ? Number.NaN
      : startMs + defaultDurationMs
    : endMsRaw;
  const nowMs = now.getTime();
  const status = String(statusRaw ?? "").toUpperCase();

  if (type === "sport") {
    if ((status === "FT" || status === "AET" || status === "POST") && Number.isFinite(endMs)) {
      const minsAfterEnd = (nowMs - endMs) / 60000;
      if (minsAfterEnd >= 0 && minsAfterEnd <= 120) {
        return {
          impactLevel: "high",
          message: "Event finished nearby - pickup demand rising",
          confidence: 0.82,
        };
      }
    }
    if (Number.isFinite(startMs)) {
      const minsToStart = (startMs - nowMs) / 60000;
      if (minsToStart >= 0 && minsToStart <= 60) {
        return {
          impactLevel: "high",
          message: "Match starting soon near Windsor Park",
          confidence: 0.86,
        };
      }
      if (minsToStart > 60 && minsToStart <= 120) {
        return {
          impactLevel: "elevated",
          message: "Inbound event traffic building over the next 2 hours",
          confidence: 0.73,
        };
      }
    }
    return {
      impactLevel: "normal",
      message: "No notable sports demand shift right now",
      confidence: 0.55,
    };
  }

  if (type === "concert") {
    if (Number.isFinite(endMs)) {
      const minsToEnd = (endMs - nowMs) / 60000;
      const minsAfterEnd = (nowMs - endMs) / 60000;
      if (minsToEnd >= 0 && minsToEnd <= 90) {
        return {
          impactLevel: "high",
          message: "Concert finishing soon - strong pickup opportunity expected",
          confidence: 0.88,
        };
      }
      if (minsAfterEnd >= 90 && minsAfterEnd <= 180) {
        return {
          impactLevel: "high",
          message: "Post-event pickups likely to stay strong for the next hour",
          confidence: 0.79,
        };
      }
    }
    if (Number.isFinite(startMs)) {
      const minsToStart = (startMs - nowMs) / 60000;
      if (minsToStart >= 0 && minsToStart <= 60) {
        return {
          impactLevel: "high",
          message: "Concert starting soon - peak drop-off activity expected",
          confidence: 0.84,
        };
      }
      if (minsToStart > 60 && minsToStart <= 120) {
        return {
          impactLevel: "elevated",
          message: "Early concert arrivals expected over the next 2 hours",
          confidence: 0.74,
        };
      }
    }
    return {
      impactLevel: "normal",
      message: "No notable concert demand shift right now",
      confidence: 0.54,
    };
  }

  return {
    impactLevel: "normal",
    message: "No notable demand signal",
    confidence: 0.5,
  };
}

function buildUnifiedEvent({
  id,
  type,
  source,
  location,
  startTime,
  endTime,
  status,
  confidence,
  metadata,
  preWindow,
  postWindow,
}) {
  return {
    id,
    type,
    source,
    locationId: location.id,
    location: {
      name: location.name,
      lat: location.lat,
      lng: location.lng,
      postcode: location.postcode,
    },
    startTime,
    endTime,
    status,
    confidence: clampConfidence(confidence),
    metadata: metadata ?? {},
    demandProfile: {
      preWindow: preWindow ?? [],
      postWindow: postWindow ?? [],
    },
  };
}

function buildCachedLocationSignal({
  location,
  source,
  type,
  windowStart,
  windowEnd,
  status,
  baseline,
  current,
  impactLevel,
  message,
  events,
  confidence,
}) {
  return {
    locationId: location.id,
    source,
    type,
    locationName: location.name,
    postcode: location.postcode,
    windowStart,
    windowEnd,
    status,
    baseline,
    current,
    impactLevel,
    message,
    events: events ?? [],
    confidence: clampConfidence(confidence),
    updatedAt: nowIso(),
  };
}

function createSmartDiarySignalEngine(options) {
  const {
    uploadsDir,
    translinkRail,
    mvpLocations = listMvpLocations(),
  } = options;

  const artifactDir = path.join(uploadsDir, "smart-diary");
  ensureDir(artifactDir);
  const cacheFile = path.join(artifactDir, "location-signal-cache.json");
  const activeFile = path.join(artifactDir, "active-locations.json");
  const contextsFile = path.join(artifactDir, "driver-contexts.json");

  const cache = safeReadJson(cacheFile, {
    updatedAt: null,
    locations: {},
    baselines: {},
    sourceStatus: {},
  });

  const activeState = safeReadJson(activeFile, {
    updatedAt: null,
    activeLocationIds: [],
    byReason: {},
  });

  const driverContexts = new Map();
  const contextSeed = safeReadJson(contextsFile, []);
  for (const item of contextSeed) {
    const key = sanitizeDriverId(item?.driverId);
    if (!key) continue;
    driverContexts.set(key, item);
  }

  const pollConfig = {
    train: { everyMinutes: 5 },
    airport: { everyMinutes: 15 },
    sport: { everyMinutes: 10 },
    concert: { everyMinutes: 45 },
  };

  const pollingTimers = [];

  function saveContexts() {
    safeWriteJson(contextsFile, Array.from(driverContexts.values()));
  }

  function saveCache() {
    cache.updatedAt = nowIso();
    safeWriteJson(cacheFile, cache);
  }

  function saveActive() {
    activeState.updatedAt = nowIso();
    safeWriteJson(activeFile, activeState);
  }

  function getSourceEnabled() {
    return {
      translink: true,
      sportsdb: Boolean(process.env.SPORTSDB_API_KEY || process.env.SPORTSDB_EVENTS_URL),
      ticketmaster: Boolean(process.env.TICKETMASTER_API_KEY),
      airport_api: Boolean(process.env.AIRPORT_API_KEY || process.env.AIRPORT_API_BASE_URL),
    };
  }

  function normalizeContextPayload(payload) {
    return {
      driverId: sanitizeDriverId(payload?.driverId),
      online: payload?.online === true,
      latitude: toNumber(payload?.latitude),
      longitude: toNumber(payload?.longitude),
      currentPostcode: normalizePostcode(payload?.currentPostcode),
      savedPostcodes: Array.isArray(payload?.savedPostcodes)
        ? payload.savedPostcodes.map(normalizePostcode).filter(Boolean)
        : [],
      favouriteLocationIds: Array.isArray(payload?.favouriteLocationIds)
        ? payload.favouriteLocationIds.map((value) => String(value)).filter(Boolean)
        : [],
      favouritedPostcodes: Array.isArray(payload?.favouritedPostcodes)
        ? payload.favouritedPostcodes.map(normalizePostcode).filter(Boolean)
        : [],
      updatedAt: nowIso(),
    };
  }

  function upsertDriverContext(payload) {
    const normalized = normalizeContextPayload(payload);
    if (!normalized.driverId) {
      throw new Error("driverId is required");
    }
    driverContexts.set(normalized.driverId, normalized);
    saveContexts();
    recomputeActiveLocations();
    return normalized;
  }

  function recomputeActiveLocations() {
    const onlineContexts = Array.from(driverContexts.values()).filter((context) => context.online);
    const nextIds = new Set();
    const byReason = {};

    for (const location of mvpLocations) {
      const reasons = [];
      for (const context of onlineContexts) {
        const near =
          context.latitude != null &&
          context.longitude != null &&
          haversineMiles(context.latitude, context.longitude, location.lat, location.lng) <= 5;

        const postcodeMatch =
          normalizePostcode(location.postcode) &&
          [
            context.currentPostcode,
            ...(context.savedPostcodes ?? []),
            ...(context.favouritedPostcodes ?? []),
          ]
            .filter(Boolean)
            .includes(normalizePostcode(location.postcode));

        const favourited = (context.favouriteLocationIds ?? []).includes(location.id);

        if (near || postcodeMatch || favourited) {
          nextIds.add(location.id);
          if (near) reasons.push(`${context.driverId}:nearby`);
          if (postcodeMatch) reasons.push(`${context.driverId}:postcode_match`);
          if (favourited) reasons.push(`${context.driverId}:favourite`);
        }
      }
      if (reasons.length > 0) {
        byReason[location.id] = reasons;
      }
    }

    activeState.activeLocationIds = Array.from(nextIds);
    activeState.byReason = byReason;
    saveActive();
    return {
      activeLocationIds: activeState.activeLocationIds,
      byReason,
      onlineDriversCount: onlineContexts.length,
    };
  }

  function getActiveLocations() {
    const activeIds = new Set(activeState.activeLocationIds ?? []);
    return mvpLocations
      .filter((location) => activeIds.has(location.id))
      .map((location) => ({
        ...location,
        reasons: activeState.byReason?.[location.id] ?? [],
      }));
  }

  function ensureBaselineNode(locationId, signalType, bucketKey) {
    if (!cache.baselines[locationId]) cache.baselines[locationId] = {};
    if (!cache.baselines[locationId][signalType]) cache.baselines[locationId][signalType] = {};
    if (!cache.baselines[locationId][signalType][bucketKey]) {
      cache.baselines[locationId][signalType][bucketKey] = {
        samples: 0,
        mean: 1,
        updatedAt: null,
      };
    }
    return cache.baselines[locationId][signalType][bucketKey];
  }

  function updateRollingBaseline(locationId, signalType, currentCount, date = new Date()) {
    const bucketKey = makeBucketKey(date);
    const node = ensureBaselineNode(locationId, signalType, bucketKey);
    const alpha = 0.2;
    const safeCount = Number.isFinite(currentCount) ? Number(currentCount) : 0;
    const nextMean = node.samples > 0 ? node.mean * (1 - alpha) + safeCount * alpha : safeCount;
    node.samples += 1;
    node.mean = Number(nextMean.toFixed(2));
    node.updatedAt = nowIso();
    return node;
  }

  function writeLocationSignals(locationId, signalsByType) {
    if (!cache.locations[locationId]) {
      cache.locations[locationId] = {
        locationId,
        signalsByType: {},
        updatedAt: null,
        expiresAt: null,
      };
    }
    cache.locations[locationId].signalsByType = {
      ...cache.locations[locationId].signalsByType,
      ...signalsByType,
    };
    cache.locations[locationId].updatedAt = nowIso();
    cache.locations[locationId].expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  }

  function setSourceStatus(source, patch) {
    cache.sourceStatus[source] = {
      ...(cache.sourceStatus[source] ?? {}),
      ...patch,
      updatedAt: nowIso(),
    };
  }

  async function fetchSportsDbEvents(location) {
    const urlBase = process.env.SPORTSDB_EVENTS_URL;
    const apiKey = process.env.SPORTSDB_API_KEY;
    if (!urlBase && !apiKey) {
      return { source: "fallback", events: [] };
    }
    const endpoint =
      urlBase ??
      `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/eventsnextvenue.php`;
    const url = new URL(endpoint);
    const venueName =
      location.sources?.sportsdb?.venueName ?? location.sources?.sportsdb?.teamHint ?? location.name;
    if (!url.searchParams.has("id") && venueName) {
      url.searchParams.set("v", venueName);
    }
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`SportsDB request failed (${response.status})`);
    }
    const payload = await response.json();
    const eventsRaw = payload?.events ?? payload?.event ?? payload?.results ?? [];
    const events = (Array.isArray(eventsRaw) ? eventsRaw : [])
      .map((event) => {
        const startTime = event?.strTimestamp ?? event?.dateEvent ?? event?.dateEventLocal ?? null;
        const endTime = event?.strEndTime ?? null;
        const status = event?.strStatus ?? event?.intStatus ?? "NS";
        const name = event?.strEvent ?? event?.strHomeTeam ?? "Sports event";
        return {
          id: String(event?.idEvent ?? `${location.id}_${name}_${startTime ?? "na"}`),
          name,
          startTime,
          endTime,
          status,
          metadata: {
            league: event?.strLeague ?? null,
            sport: event?.strSport ?? "sport",
            venue: event?.strVenue ?? location.name,
          },
        };
      })
      .filter((event) => Boolean(event.startTime));

    return {
      source: "sportsdb",
      events,
    };
  }

  async function fetchTicketmasterEvents(location) {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) {
      return { source: "fallback", events: [] };
    }
    const endpoint = process.env.TICKETMASTER_BASE_URL ?? "https://app.ticketmaster.com/discovery/v2/events.json";
    const url = new URL(endpoint);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("size", "10");
    url.searchParams.set("sort", "date,asc");
    if (location.sources?.ticketmaster?.venueId) {
      url.searchParams.set("venueId", String(location.sources.ticketmaster.venueId));
    } else {
      url.searchParams.set("keyword", location.sources?.ticketmaster?.keyword ?? location.name);
    }
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Ticketmaster request failed (${response.status})`);
    }
    const payload = await response.json();
    const eventsRaw = payload?._embedded?.events ?? [];
    const events = eventsRaw
      .map((event) => {
        const startDate = event?.dates?.start?.dateTime ?? event?.dates?.start?.localDate ?? null;
        const status = event?.dates?.status?.code ?? event?.dates?.status?.statusCode ?? "onsale";
        const classification = Array.isArray(event?.classifications)
          ? event.classifications[0]
          : null;
        const genre = classification?.genre?.name ?? classification?.segment?.name ?? null;
        return {
          id: String(event?.id ?? `${location.id}_${event?.name ?? "event"}_${startDate ?? "na"}`),
          name: event?.name ?? "Event",
          startTime: startDate,
          endTime: null,
          status,
          metadata: {
            genre,
            attraction: Array.isArray(event?._embedded?.attractions)
              ? event._embedded.attractions[0]?.name ?? null
              : null,
            venue: Array.isArray(event?._embedded?.venues)
              ? event._embedded.venues[0]?.name ?? location.name
              : location.name,
          },
        };
      })
      .filter((event) => Boolean(event.startTime));

    return {
      source: "ticketmaster",
      events,
    };
  }

  async function fetchAirportSignal(location) {
    const apiBaseUrl = process.env.AIRPORT_API_BASE_URL;
    const apiKey = process.env.AIRPORT_API_KEY;
    const airportCode = location.sources?.airport?.airportCode;
    if (!apiBaseUrl || !apiKey || !airportCode) {
      return {
        source: "fallback",
        arrivalsNextHour: 0,
        departuresNextHour: 0,
        delayedOrCancelled: 0,
        sample: [],
      };
    }

    const url = new URL(apiBaseUrl);
    url.searchParams.set("airport", airportCode);
    url.searchParams.set("window", "next_hour");
    const response = await fetch(url.toString(), {
      headers: {
        "x-api-key": apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Airport API request failed (${response.status})`);
    }
    const payload = await response.json();
    const arrivals = Number(payload?.arrivalsPerHour ?? payload?.arrivals_next_hour ?? 0);
    const departures = Number(payload?.departuresPerHour ?? payload?.departures_next_hour ?? 0);
    const delayed = Number(payload?.delayOrCancellationCount ?? payload?.delayed_or_cancelled ?? 0);
    return {
      source: "airport_api",
      arrivalsNextHour: Number.isFinite(arrivals) ? arrivals : 0,
      departuresNextHour: Number.isFinite(departures) ? departures : 0,
      delayedOrCancelled: Number.isFinite(delayed) ? delayed : 0,
      sample: Array.isArray(payload?.flights) ? payload.flights.slice(0, 5) : [],
    };
  }

  async function pollTrainLocation(location) {
    const hubKey = location.sources?.translink?.hubKey;
    if (!hubKey) return null;
    const result = await translinkRail.getSmartDiarySignalForHub(hubKey, {});
    if (!result) return null;

    const baseline = Number(result?.baselineCount ?? 0);
    const current = Number(result?.nextHourExpectedArrivalsCount ?? 0);
    const impactLevel =
      result?.status === "very_busy"
        ? "high"
        : result?.status === "busy"
          ? "elevated"
          : "normal";

    const message =
      result?.cancellationsCountInNextHour > 0
        ? "Rail disruption expected in this period"
        : impactLevel === "high"
          ? "Significantly higher than average passenger arrivals expected"
          : impactLevel === "elevated"
            ? "Higher than average passenger arrivals expected"
            : "Nothing notable to share";

    const signal = buildCachedLocationSignal({
      location,
      source: "translink",
      type: "train",
      windowStart: nowIso(),
      windowEnd: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: result?.status ?? "normal",
      baseline,
      current,
      impactLevel,
      message,
      confidence: result?.cancellationsCountInNextHour > 0 ? 0.9 : impactLevel === "normal" ? 0.62 : 0.8,
      events: result?.nextThree ?? [],
    });

    const unifiedEvent = buildUnifiedEvent({
      id: `train_${location.id}_${Date.now()}`,
      type: "train",
      source: "translink",
      location,
      startTime: signal.windowStart,
      endTime: signal.windowEnd,
      status: signal.status,
      confidence: signal.confidence,
      metadata: {
        cancellationsCount: result?.cancellationsCountInNextHour ?? 0,
        alertItems: result?.alertItems ?? [],
        nextThree: result?.nextThree ?? [],
      },
      preWindow: [{ minutes: -60, expectedDemand: "arrivals_flow" }],
      postWindow: [{ minutes: 30, expectedDemand: "pickup_flow" }],
    });

    writeLocationSignals(location.id, { train: signal });
    writeLocationSignals(location.id, {
      unifiedEvents: [
        ...(cache.locations?.[location.id]?.signalsByType?.unifiedEvents ?? []).filter(
          (event) => event.type !== "train",
        ),
        unifiedEvent,
      ],
    });
    setSourceStatus("translink", {
      lastPolledAt: nowIso(),
      pollEveryMinutes: pollConfig.train.everyMinutes,
    });
    saveCache();
    return signal;
  }

  async function pollAirportLocation(location) {
    const airport = await fetchAirportSignal(location);
    const baselineNode = updateRollingBaseline(location.id, "airport", airport.arrivalsNextHour, new Date());
    const baseline = Number(baselineNode.mean ?? 0);
    const current = Number(airport.arrivalsNextHour ?? 0);
    const impactLevel = inferImpactLevel(current, baseline, 1.5, 1.1);
    const delayed = Number(airport.delayedOrCancelled ?? 0);

    const message =
      delayed > 0
        ? "Flight delays/cancellations may increase pickup volatility"
        : impactLevel === "high"
          ? "High inbound demand expected"
          : impactLevel === "elevated"
            ? "Higher than usual arrivals at airport in next hour"
            : "Nothing notable to share";

    const signal = buildCachedLocationSignal({
      location,
      source: airport.source,
      type: "airport",
      windowStart: nowIso(),
      windowEnd: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: delayed > 0 ? "disrupted" : impactLevel,
      baseline,
      current,
      impactLevel: delayed > 0 ? "high" : impactLevel,
      message,
      confidence: delayed > 0 ? 0.9 : impactLevel === "normal" ? 0.58 : 0.78,
      events: airport.sample,
    });

    const unifiedEvent = buildUnifiedEvent({
      id: `airport_${location.id}_${Date.now()}`,
      type: "airport",
      source: airport.source,
      location,
      startTime: signal.windowStart,
      endTime: signal.windowEnd,
      status: signal.status,
      confidence: signal.confidence,
      metadata: {
        arrivalsNextHour: current,
        departuresNextHour: airport.departuresNextHour,
        delayedOrCancelled: delayed,
      },
      preWindow: [{ minutes: -60, expectedDemand: "inbound_flow" }],
      postWindow: [{ minutes: 45, expectedDemand: "pickup_flow" }],
    });

    writeLocationSignals(location.id, { airport: signal });
    writeLocationSignals(location.id, {
      unifiedEvents: [
        ...(cache.locations?.[location.id]?.signalsByType?.unifiedEvents ?? []).filter(
          (event) => event.type !== "airport",
        ),
        unifiedEvent,
      ],
    });
    setSourceStatus("airport_api", {
      lastPolledAt: nowIso(),
      pollEveryMinutes: pollConfig.airport.everyMinutes,
    });
    saveCache();
    return signal;
  }

  async function pollEventLocation(location, eventType) {
    const fetcher = eventType === "sport" ? fetchSportsDbEvents : fetchTicketmasterEvents;
    const sourceName = eventType === "sport" ? "sportsdb" : "ticketmaster";
    const fetched = await fetcher(location);
    const now = new Date();

    const normalizedEvents = fetched.events
      .map((event) => {
        const state = getTimeWindowState(eventType, event.startTime, event.endTime, event.status, now);
        return buildUnifiedEvent({
          id: event.id,
          type: eventType,
          source: fetched.source,
          location,
          startTime: event.startTime,
          endTime: event.endTime,
          status: event.status,
          confidence: state.confidence,
          metadata: {
            eventName: event.name,
            ...event.metadata,
          },
          preWindow: [{ minutes: -120, expectedDemand: "inbound_flow" }, { minutes: -60, expectedDemand: "dropoff_peak" }],
          postWindow:
            eventType === "sport"
              ? [{ minutes: 120, expectedDemand: "post_event_pickup" }]
              : [{ minutes: 180, expectedDemand: "post_event_pickup" }],
        });
      })
      .sort((a, b) => Date.parse(a.startTime ?? "") - Date.parse(b.startTime ?? ""));

    const nextEvent = normalizedEvents[0] ?? null;
    const state = nextEvent
      ? getTimeWindowState(eventType, nextEvent.startTime, nextEvent.endTime, nextEvent.status, now)
      : { impactLevel: "normal", message: "Nothing notable to share", confidence: 0.5 };

    const current = normalizedEvents.length;
    const baselineNode = updateRollingBaseline(location.id, eventType, current, now);
    const baseline = Number(baselineNode.mean ?? 0);

    const signal = buildCachedLocationSignal({
      location,
      source: fetched.source,
      type: eventType,
      windowStart: nowIso(),
      windowEnd: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      status: nextEvent?.status ?? "idle",
      baseline,
      current,
      impactLevel: state.impactLevel,
      message: state.message,
      confidence: state.confidence,
      events: normalizedEvents.slice(0, 5).map((event) => ({
        id: event.id,
        name: event.metadata?.eventName ?? "Event",
        startTime: event.startTime,
        endTime: event.endTime,
        status: event.status,
      })),
    });

    writeLocationSignals(location.id, { [eventType]: signal });
    writeLocationSignals(location.id, {
      unifiedEvents: [
        ...(cache.locations?.[location.id]?.signalsByType?.unifiedEvents ?? []).filter(
          (event) => event.type !== eventType,
        ),
        ...normalizedEvents,
      ],
    });
    setSourceStatus(sourceName, {
      lastPolledAt: nowIso(),
      pollEveryMinutes: pollConfig[eventType].everyMinutes,
    });
    saveCache();
    return signal;
  }

  async function pollSourceForActiveLocations(signalType) {
    const active = getActiveLocations();
    const locations = active.filter((location) => location.type === signalType);
    if (locations.length === 0) return [];

    const results = [];
    for (const location of locations) {
      try {
        if (signalType === "train") {
          const signal = await pollTrainLocation(location);
          if (signal) results.push(signal);
          continue;
        }
        if (signalType === "airport") {
          const signal = await pollAirportLocation(location);
          if (signal) results.push(signal);
          continue;
        }
        if (signalType === "sport" || signalType === "concert") {
          const signal = await pollEventLocation(location, signalType);
          if (signal) results.push(signal);
          continue;
        }
      } catch (error) {
        setSourceStatus(signalType, {
          lastError: error instanceof Error ? error.message : "Unknown polling error",
          lastPolledAt: nowIso(),
        });
      }
    }
    saveCache();
    return results;
  }

  async function pollAllActiveSources() {
    const sourceEnabled = getSourceEnabled();
    const output = {
      polledAt: nowIso(),
      activeLocationIds: activeState.activeLocationIds ?? [],
      sourceEnabled,
      results: {
        train: await pollSourceForActiveLocations("train"),
        airport: sourceEnabled.airport_api ? await pollSourceForActiveLocations("airport") : [],
        sport: sourceEnabled.sportsdb ? await pollSourceForActiveLocations("sport") : [],
        concert: sourceEnabled.ticketmaster ? await pollSourceForActiveLocations("concert") : [],
      },
    };
    return output;
  }

  function startPolling() {
    for (const timer of pollingTimers) clearInterval(timer);
    pollingTimers.length = 0;

    const runTrain = () => pollSourceForActiveLocations("train").catch(() => null);
    const runAirport = () => pollSourceForActiveLocations("airport").catch(() => null);
    const runSport = () => pollSourceForActiveLocations("sport").catch(() => null);
    const runConcert = () => pollSourceForActiveLocations("concert").catch(() => null);

    pollingTimers.push(setInterval(runTrain, pollConfig.train.everyMinutes * 60 * 1000));
    pollingTimers.push(setInterval(runAirport, pollConfig.airport.everyMinutes * 60 * 1000));
    pollingTimers.push(setInterval(runSport, pollConfig.sport.everyMinutes * 60 * 1000));
    pollingTimers.push(setInterval(runConcert, pollConfig.concert.everyMinutes * 60 * 1000));

    pollAllActiveSources().catch(() => null);
  }

  function buildSmartDiaryPayload(query = {}) {
    const driverId = sanitizeDriverId(query.driverId);
    const context = driverId ? driverContexts.get(driverId) ?? null : null;
    const latitude = toNumber(query.lat ?? context?.latitude);
    const longitude = toNumber(query.lng ?? context?.longitude);
    const postcode = normalizePostcode(query.postcode ?? context?.currentPostcode);

    const activeIds = new Set(activeState.activeLocationIds ?? []);
    const relevantLocations = mvpLocations.filter((location) => {
      if (activeIds.has(location.id)) return true;
      const postcodeMatch = postcode && normalizePostcode(location.postcode) === postcode;
      const near =
        latitude != null && longitude != null
          ? haversineMiles(latitude, longitude, location.lat, location.lng) <= 5
          : false;
      return postcodeMatch || near;
    });

    const relevantSignals = [];
    for (const location of relevantLocations) {
      const signalsByType = cache.locations?.[location.id]?.signalsByType ?? {};
      for (const signal of [signalsByType.train, signalsByType.airport, signalsByType.sport, signalsByType.concert]) {
        if (!signal) continue;
        relevantSignals.push(signal);
      }
    }

    const highImpactSignals = relevantSignals
      .filter((signal) => signal.impactLevel === "high")
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

    const upcomingAlerts = relevantSignals
      .filter((signal) => signal.impactLevel === "high" || signal.impactLevel === "elevated")
      .map((signal) => ({
        locationId: signal.locationId,
        locationName: signal.locationName,
        signalType: signal.type,
        source: signal.source,
        message: signal.message,
        impactLevel: signal.impactLevel,
        relevantWindow: {
          start: signal.windowStart,
          end: signal.windowEnd,
        },
      }))
      .sort((a, b) => Date.parse(a.relevantWindow.start) - Date.parse(b.relevantWindow.start));

    return {
      generatedAt: nowIso(),
      pollingModel: "central_location_cache_shared_across_drivers",
      notes: {
        noPerDriverExternalApiCalls: true,
        clientCallsBackendOnly: true,
      },
      nearbyHighImpactSignals: highImpactSignals,
      upcomingAlerts,
      allRelevantSignals: relevantSignals,
    };
  }

  function getLocationSignals(locationId) {
    return cache.locations?.[locationId]?.signalsByType ?? null;
  }

  return {
    pollConfig,
    getSourceEnabled,
    upsertDriverContext,
    recomputeActiveLocations,
    getActiveLocations,
    getDriverContexts: () => Array.from(driverContexts.values()),
    getLocations: () => mvpLocations,
    pollAllActiveSources,
    buildSmartDiaryPayload,
    getLocationSignals,
    getCacheSnapshot: () => cache,
    startPolling,
  };
}

module.exports = {
  createSmartDiarySignalEngine,
  buildUnifiedEvent,
  buildCachedLocationSignal,
  inferImpactLevel,
};
