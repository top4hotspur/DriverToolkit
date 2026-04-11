const { toNormalizedSignal } = require("../signalModel");
const { fetchUpcomingEvents } = require("../ticketmaster");

const DEFAULT_EVENT_DURATION_MINUTES = {
  music: 210,
  sports: 160,
  arts: 150,
  family: 140,
  comedy: 140,
  misc: 150,
};

const EVENT_WINDOW_RULE = {
  preEventStartMinusMinutes: 90,
  preEventEndPlusMinutes: 30,
  postEventEndPlusMinutes: 120,
};

function createTicketmasterSignalProvider(options = {}) {
  const { adminConfig } = options;

  async function collectSignals(args = {}) {
    const now = args.now ? new Date(args.now) : new Date();
    const config = adminConfig?.get?.() ?? {};
    const providerEnabled = config.providers?.ticketmaster?.enabled === true;
    if (!providerEnabled) {
      return {
        generatedAt: now.toISOString(),
        signals: [],
        diagnostics: {
          providerStatus: "disabled",
          eventsFetchedCount: 0,
          eventsNormalizedCount: 0,
          eventsIncludedCount: 0,
          eventsExcludedCount: 0,
          exclusionReasons: [{ reason: "provider_disabled", count: 1 }],
          countriesQueried: [],
          venuesQueried: [],
        },
      };
    }

    const eventsConfig = config.ticketmaster ?? {};
    const endpointMode = String(args.mode ?? "unknown").trim() || "unknown";
    const selectedDate = typeof args.date === "string" ? args.date.trim() : null;
    const horizonContext = resolveHorizonContext({
      endpointMode,
      selectedDate,
      now,
      horizonDays: Number(eventsConfig.horizonDays ?? 7),
    });
    const favouritesWatchlist = normalizeFavouritesWatchlist(args.favouritesWatchlist);
    const watchlistSummary = {
      venueNames: favouritesWatchlist.venueNames.slice(0, 20),
      placeLabels: favouritesWatchlist.placeLabels.slice(0, 20),
      postcodes: favouritesWatchlist.postcodes.slice(0, 20),
      outwardCodes: favouritesWatchlist.outwardCodes.slice(0, 20),
      broadCities: favouritesWatchlist.broadCities.slice(0, 20),
      allowBroadCity: favouritesWatchlist.allowBroadCity,
    };
    const favouritesWatchlistCount =
      favouritesWatchlist.venueNames.length +
      favouritesWatchlist.placeLabels.length +
      favouritesWatchlist.postcodes.length +
      favouritesWatchlist.outwardCodes.length +
      favouritesWatchlist.broadCities.length;
    console.log(
      `[FAVOURITES][watchlist] provider=ticketmaster venues=${favouritesWatchlist.venueNames.length} places=${favouritesWatchlist.placeLabels.length} postcodes=${favouritesWatchlist.postcodes.length} outward=${favouritesWatchlist.outwardCodes.length} broadCities=${favouritesWatchlist.broadCities.length} allowBroadCity=${String(
        favouritesWatchlist.allowBroadCity,
      )}`,
    );
    if (favouritesWatchlistCount === 0) {
      return {
        generatedAt: now.toISOString(),
        signals: [],
        diagnostics: {
          providerStatus: "no_favourites_watchlist",
          eventsFetchedCount: 0,
          eventsNormalizedCount: 0,
          eventsIncludedCount: 0,
          eventsExcludedCount: 0,
          eventsExcludedNotInFavouritesCount: 0,
          exclusionReasons: [{ reason: "no_favourites_watchlist", count: 1 }],
          countriesQueried: [],
          venuesQueried: [],
          favouriteWatchlistSummary: watchlistSummary,
          favouritesWatchlistCount,
        },
      };
    }
    const countryCode = normalizeCountryCode(args.country ?? eventsConfig.countryCode ?? "GB");
    const city = args.cityExplicit === true
      ? String(args.city ?? "").trim()
      : String(eventsConfig.city ?? args.city ?? "").trim();

    console.log(`[EVENTS][fetch] start country=${countryCode ?? "any"} city=${city || "any"}`);
    console.log(
      `[EVENTS][horizon] endpointMode=${endpointMode} selectedDate=${selectedDate ?? "n/a"} horizonMode=${horizonContext.horizonMode} selectedDateWindowStart=${horizonContext.selectedDateWindowStart ?? "n/a"} selectedDateWindowEnd=${horizonContext.selectedDateWindowEnd ?? "n/a"}`,
    );
    let fetchResult;
    try {
      fetchResult = await fetchUpcomingEvents({
        apiKey: process.env.TICKETMASTER_API_KEY ?? eventsConfig.apiKey,
        countryCode,
        city: city || null,
        now: args.now,
        timeoutMs: Number.isFinite(Number(eventsConfig.timeoutMs)) ? Number(eventsConfig.timeoutMs) : 6500,
        size: Number.isFinite(Number(eventsConfig.size)) ? Number(eventsConfig.size) : 100,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[EVENTS][fetch] fail error=${message}`);
      return {
        generatedAt: now.toISOString(),
        signals: [],
        diagnostics: {
          providerStatus: "fetch_failed",
          eventsFetchedCount: 0,
          eventsNormalizedCount: 0,
          eventsIncludedCount: 0,
          eventsExcludedCount: 0,
          exclusionReasons: [{ reason: "provider_fetch_failed", count: 1 }],
          countriesQueried: countryCode ? [countryCode] : [],
          venuesQueried: [],
          error: message,
        },
      };
    }

    const fetchedEvents = Array.isArray(fetchResult.events) ? fetchResult.events : [];
    console.log(`[EVENTS][fetch] success fetched=${fetchedEvents.length}`);
    const signals = [];
    const exclusionReasons = {};
    let normalizedCount = 0;
    let includedCount = 0;
    let excludedCount = 0;
    let excludedNotInFavouritesCount = 0;
    const venuesQueried = new Set();

    for (const event of fetchedEvents) {
      const startAt = parseStartDate(event);
      if (!startAt) {
        pushReason(exclusionReasons, "missing_start_time");
        excludedCount += 1;
        continue;
      }
      const venue = resolveVenue(event);
      const classification = resolveClassification(event);
      const estimatedDurationMinutes = getDurationMinutes(classification);
      const endsAtEstimated = new Date(startAt.getTime() + estimatedDurationMinutes * 60 * 1000);
      const preStart = new Date(startAt.getTime() - EVENT_WINDOW_RULE.preEventStartMinusMinutes * 60 * 1000);
      const preEnd = new Date(startAt.getTime() + EVENT_WINDOW_RULE.preEventEndPlusMinutes * 60 * 1000);
      const postStart = new Date(endsAtEstimated.getTime());
      const postEnd = new Date(endsAtEstimated.getTime() + EVENT_WINDOW_RULE.postEventEndPlusMinutes * 60 * 1000);
      if (
        !isWithinHorizon(
          {
            startAt,
            preWindowStart: preStart,
            preWindowEnd: preEnd,
            postWindowStart: postStart,
            postWindowEnd: postEnd,
          },
          horizonContext,
        )
      ) {
        pushReason(exclusionReasons, "outside_horizon");
        excludedCount += 1;
        console.log(
          `[EVENTS][filter] excluded reason=outside_horizon endpointMode=${endpointMode} selectedDate=${selectedDate ?? "n/a"} horizonMode=${horizonContext.horizonMode} sourceStartTime=${startAt.toISOString()} selectedDateWindowStart=${horizonContext.selectedDateWindowStart ?? "n/a"} selectedDateWindowEnd=${horizonContext.selectedDateWindowEnd ?? "n/a"}`,
        );
        continue;
      }
      const favouriteMatch = resolveFavouriteMatch(
        event,
        venue,
        favouritesWatchlist,
        Number.isFinite(Number(args.radiusMiles)) ? Number(args.radiusMiles) : null,
      );
      if (!favouriteMatch.matched) {
        pushReason(exclusionReasons, "not_in_favourites");
        excludedNotInFavouritesCount += 1;
        console.log(
          `[EVENTS][favourites][exclude] venue=${String(venue.venueName ?? "n/a")} favouriteMatched=false favouriteMatchType=none filteredOutReason=not_in_favourites`,
        );
        excludedCount += 1;
        continue;
      }
      console.log(
        `[EVENTS][favourites][include] venue=${String(venue.venueName ?? "n/a")} favouriteMatched=true favouriteMatchType=${favouriteMatch.matchType} favouriteMatchValue=${String(
          favouriteMatch.matchValue ?? "n/a",
        )}`,
      );
      if (venue.venueName) {
        venuesQueried.add(venue.venueName);
      }
      const eventName = String(event?.name ?? "Event");
      const eventId = String(event?.id ?? slugify(eventName));
      const localTimeLabel = formatLocalTimeWindow(startAt, endsAtEstimated);
      const baseMetadata = {
        provider: "ticketmaster",
        category: "events",
        isBaseline: true,
        isLiveException: false,
        sourceEventId: eventId,
        sourceEventName: eventName,
        sourceEventType: classification,
        sourceStartTime: startAt.toISOString(),
        estimatedEndTime: endsAtEstimated.toISOString(),
        eventType: classification,
        venueName: venue.venueName,
        venueCity: venue.city,
        venueCountry: venue.country,
        postcode: venue.postcode,
        lat: venue.lat,
        lng: venue.lng,
        geoConfidence: venue.geoConfidence,
        geoResolutionStatus: venue.geoResolutionStatus,
        configuredRadiusMiles: null,
        distanceMiles: null,
        withinRadius: venue.geoConfidence === "exact",
        eligibilityReason: venue.geoConfidence === "exact" ? "geo_exact_ready_for_radius_eval" : "geo_not_exact",
        filteredOutReason: null,
        promotionEligible: venue.geoConfidence === "exact",
        favouriteMatched: true,
        monitoredByFavourites: true,
        favouriteMatchType: favouriteMatch.matchType,
        favouriteMatchValue: favouriteMatch.matchValue,
        estimatedDurationMinutes,
        endTimeInferenceRule: `default_duration_${classification}`,
        signalWindowRule: EVENT_WINDOW_RULE,
        providerDiagnostics: {
          source: "ticketmaster",
          classifications: event?.classifications ?? [],
          endpointMode,
          selectedDate,
          horizonMode: horizonContext.horizonMode,
          sourceStartTime: startAt.toISOString(),
          selectedDateWindowStart: horizonContext.selectedDateWindowStart,
          selectedDateWindowEnd: horizonContext.selectedDateWindowEnd,
          venueFields: {
            name: venue.venueName,
            city: venue.city,
            country: venue.country,
            lat: venue.lat,
            lng: venue.lng,
          },
        },
      };

      signals.push(
        toNormalizedSignal({
          id: `ticketmaster:${eventId}:events_pre_arrivals:${preStart.toISOString()}`,
          provider: "ticketmaster",
          providerKey: "ticketmaster",
          category: "events",
          competition: classification,
          regionKey: String(args.regionKey ?? "uk-ni"),
          signalType: "events_pre_arrivals",
          title: `${venue.venueName ?? "Venue"} arrivals building`,
          subtitle: `${eventName} pre-event arrivals expected`,
          description: `${eventName} pre-event arrivals likely around ${formatClock(startAt)}.`,
          severity: "warning",
          startsAt: preStart.toISOString(),
          endsAt: preEnd.toISOString(),
          localTimeLabel,
          expectedIntensity: "elevated",
          location: {
            locationId: `event:${slugify(venue.venueName ?? eventName)}`,
            name: venue.venueName ?? eventName,
            postcode: venue.postcode,
            lat: venue.lat,
            lng: venue.lng,
            city: venue.city,
          },
          metadata: {
            ...baseMetadata,
            signalPhase: "pre_event_arrivals",
            startsAt: preStart.toISOString(),
            endsAtEstimated: preEnd.toISOString(),
          },
        }),
      );
      signals.push(
        toNormalizedSignal({
          id: `ticketmaster:${eventId}:events_post_dispersal:${postStart.toISOString()}`,
          provider: "ticketmaster",
          providerKey: "ticketmaster",
          category: "events",
          competition: classification,
          regionKey: String(args.regionKey ?? "uk-ni"),
          signalType: "events_post_dispersal",
          title: `${venue.venueName ?? "Venue"} event finishing soon`,
          subtitle: "Post-event dispersal expected",
          description: `${eventName} expected to finish around ${formatClock(endsAtEstimated)}.`,
          severity: "warning",
          startsAt: postStart.toISOString(),
          endsAt: postEnd.toISOString(),
          localTimeLabel,
          expectedIntensity: "high",
          location: {
            locationId: `event:${slugify(venue.venueName ?? eventName)}`,
            name: venue.venueName ?? eventName,
            postcode: venue.postcode,
            lat: venue.lat,
            lng: venue.lng,
            city: venue.city,
          },
          metadata: {
            ...baseMetadata,
            signalPhase: "post_event_dispersal",
            startsAt: postStart.toISOString(),
            endsAtEstimated: postEnd.toISOString(),
          },
        }),
      );
      normalizedCount += 2;
      includedCount += 2;
    }

    const diagnostics = {
      providerStatus: fetchResult.diagnostics?.providerStatus ?? "ok",
      eventsFetchedCount: Number(fetchResult.diagnostics?.eventsFetchedCount ?? fetchedEvents.length),
      eventsNormalizedCount: normalizedCount,
      eventsIncludedCount: includedCount,
      eventsExcludedCount: excludedCount,
      eventsExcludedNotInFavouritesCount: excludedNotInFavouritesCount,
      exclusionReasons: Object.entries(exclusionReasons).map(([reason, count]) => ({ reason, count })),
      countriesQueried: fetchResult.diagnostics?.countriesQueried ?? (countryCode ? [countryCode] : []),
      venuesQueried: Array.from(venuesQueried),
      providerDiagnostics: fetchResult.diagnostics ?? null,
      favouriteWatchlistSummary: watchlistSummary,
      favouritesWatchlistCount,
      endpointMode,
      selectedDate,
      horizonMode: horizonContext.horizonMode,
      selectedDateWindowStart: horizonContext.selectedDateWindowStart,
      selectedDateWindowEnd: horizonContext.selectedDateWindowEnd,
    };
    console.log(
      `[EVENTS][signals] normalized=${normalizedCount} included=${includedCount} excluded=${excludedCount}`,
    );
    return {
      generatedAt: now.toISOString(),
      signals,
      diagnostics,
    };
  }

  return {
    collectSignals,
  };
}

function parseStartDate(event) {
  const dateTime = String(event?.dates?.start?.dateTime ?? "").trim();
  if (dateTime) {
    const parsed = new Date(dateTime);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const localDate = String(event?.dates?.start?.localDate ?? "").trim();
  if (!localDate) return null;
  const localTime = String(event?.dates?.start?.localTime ?? "").trim() || "19:30:00";
  const normalizedTime = /^\d{2}:\d{2}(:\d{2})?$/.test(localTime)
    ? (localTime.length === 5 ? `${localTime}:00` : localTime)
    : "19:30:00";
  const parsed = new Date(`${localDate}T${normalizedTime}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveVenue(event) {
  const venueRaw = Array.isArray(event?._embedded?.venues) ? event._embedded.venues[0] : null;
  const venueName = String(venueRaw?.name ?? "").trim() || null;
  const city = String(venueRaw?.city?.name ?? "").trim() || null;
  const country = String(venueRaw?.country?.name ?? "").trim() || null;
  const postcode = String(venueRaw?.postalCode ?? "").trim().toUpperCase() || null;
  const lat = toFiniteNumber(venueRaw?.location?.latitude);
  const lng = toFiniteNumber(venueRaw?.location?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      venueName,
      city,
      country,
      postcode,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      geoConfidence: "exact",
      geoResolutionStatus: "provider_coordinates",
    };
  }
  if (city) {
    return {
      venueName,
      city,
      country,
      postcode,
      lat: null,
      lng: null,
      geoConfidence: "city_level",
      geoResolutionStatus: "city_only",
    };
  }
  return {
    venueName,
    city,
    country,
    postcode,
    lat: null,
    lng: null,
    geoConfidence: "missing",
    geoResolutionStatus: "missing_geo",
  };
}

function resolveClassification(event) {
  const segment = event?.classifications?.[0]?.segment?.name;
  const genre = event?.classifications?.[0]?.genre?.name;
  const fromSegment = String(segment ?? "").trim().toLowerCase();
  const fromGenre = String(genre ?? "").trim().toLowerCase();
  if (fromSegment.includes("music") || fromGenre.includes("music")) return "music";
  if (fromSegment.includes("sport") || fromGenre.includes("sport")) return "sports";
  if (fromSegment.includes("arts") || fromGenre.includes("theatre")) return "arts";
  if (fromSegment.includes("family")) return "family";
  if (fromGenre.includes("comedy")) return "comedy";
  return "misc";
}

function getDurationMinutes(classification) {
  return DEFAULT_EVENT_DURATION_MINUTES[classification] ?? 150;
}

function normalizeCountryCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "UK" || raw === "UNITED KINGDOM") return "GB";
  return raw.length > 2 ? raw.slice(0, 2) : raw;
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pushReason(map, reason) {
  map[reason] = (map[reason] ?? 0) + 1;
}

function isWithinHorizon(eventWindow, horizonContext) {
  const startAt = eventWindow?.startAt;
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    return false;
  }
  if (horizonContext?.horizonMode === "selected_date") {
    const selectedStartMs = Number(horizonContext.selectedDateWindowStartMs);
    const selectedEndMs = Number(horizonContext.selectedDateWindowEndMs);
    if (!Number.isFinite(selectedStartMs) || !Number.isFinite(selectedEndMs)) {
      return false;
    }
    const windowStartMs =
      eventWindow?.preWindowStart instanceof Date && !Number.isNaN(eventWindow.preWindowStart.getTime())
        ? eventWindow.preWindowStart.getTime()
        : startAt.getTime();
    const windowEndMs =
      eventWindow?.postWindowEnd instanceof Date && !Number.isNaN(eventWindow.postWindowEnd.getTime())
        ? eventWindow.postWindowEnd.getTime()
        : startAt.getTime();
    return windowStartMs <= selectedEndMs && windowEndMs >= selectedStartMs;
  }
  const now = horizonContext?.now instanceof Date ? horizonContext.now : new Date();
  const days = Number.isFinite(Number(horizonContext?.horizonDays))
    ? Math.max(1, Number(horizonContext.horizonDays))
    : 7;
  const diffMs = startAt.getTime() - now.getTime();
  const maxMs = days * 24 * 60 * 60 * 1000;
  return diffMs >= -2 * 60 * 60 * 1000 && diffMs <= maxMs;
}

function resolveHorizonContext({ endpointMode, selectedDate, now, horizonDays }) {
  const mode = String(endpointMode ?? "").trim().toLowerCase();
  const selectedWindow = mode === "diary" ? toLocalDayWindow(selectedDate) : null;
  if (selectedWindow) {
    return {
      horizonMode: "selected_date",
      endpointMode: mode || "unknown",
      selectedDate: selectedDate || null,
      selectedDateWindowStartMs: selectedWindow.startMs,
      selectedDateWindowEndMs: selectedWindow.endMs,
      selectedDateWindowStart: new Date(selectedWindow.startMs).toISOString(),
      selectedDateWindowEnd: new Date(selectedWindow.endMs).toISOString(),
      now,
      horizonDays,
    };
  }
  return {
    horizonMode: "rolling_now",
    endpointMode: mode || "unknown",
    selectedDate: selectedDate || null,
    selectedDateWindowStartMs: null,
    selectedDateWindowEndMs: null,
    selectedDateWindowStart: null,
    selectedDateWindowEnd: null,
    now,
    horizonDays,
  };
}

function toLocalDayWindow(dateKey) {
  const raw = String(dateKey ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function formatClock(date) {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  });
}

function formatLocalTimeWindow(startAt, endAt) {
  return `${formatClock(startAt)}-${formatClock(endAt)}`;
}

function normalizeFavouritesWatchlist(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    rawVenueNames: normalizeRawList(source.venueNames),
    venueNames: normalizeLowerList(source.venueNames),
    placeLabels: normalizeLowerList(source.placeLabels),
    postcodes: normalizeUpperList(source.postcodes),
    outwardCodes: normalizeUpperList(source.outwardCodes),
    points: normalizePoints(source.points),
    broadCities: normalizeLowerList(source.broadCities),
    allowBroadCity: source.allowBroadCity === true,
  };
}

function resolveFavouriteMatch(event, venue, watchlist, radiusMiles) {
  const venueName = String(venue.venueName ?? "").trim();
  const venueNormalized = normalizeToken(venueName);
  const exactVenueHit = watchlist.rawVenueNames.find(
    (value) => normalizeToken(value) === normalizeToken(venueName),
  );
  if (exactVenueHit) {
    return { matched: true, matchType: "venue_name_exact", matchValue: exactVenueHit };
  }
  if (venueNormalized && watchlist.venueNames.includes(venueNormalized)) {
    return { matched: true, matchType: "venue_name_normalized", matchValue: venueName };
  }
  const containsHit = watchlist.rawVenueNames.find((value) => {
    const favoriteNormalized = normalizeToken(value);
    return venueNormalized.includes(favoriteNormalized) || favoriteNormalized.includes(venueNormalized);
  });
  if (containsHit) {
    return { matched: true, matchType: "venue_name_normalized", matchValue: containsHit };
  }
  if (venueNormalized && watchlist.placeLabels.includes(venueNormalized)) {
    return { matched: true, matchType: "place_alias", matchValue: venueName };
  }
  const postcode = String(venue.postcode ?? "").trim().toUpperCase();
  if (postcode && watchlist.postcodes.includes(postcode)) {
    return { matched: true, matchType: "postcode_exact", matchValue: postcode };
  }
  const outward = deriveOutwardCode(postcode);
  if (outward && watchlist.outwardCodes.includes(outward)) {
    return { matched: true, matchType: "outward_code", matchValue: outward };
  }
  if (
    Number.isFinite(Number(radiusMiles)) &&
    Number(radiusMiles) > 0 &&
    Number.isFinite(Number(venue.lat)) &&
    Number.isFinite(Number(venue.lng)) &&
    Array.isArray(watchlist.points) &&
    watchlist.points.length > 0
  ) {
    let closest = null;
    for (const point of watchlist.points) {
      const distanceMiles = haversineMiles(Number(venue.lat), Number(venue.lng), point.lat, point.lng);
      if (!closest || distanceMiles < closest.distanceMiles) {
        closest = { point, distanceMiles };
      }
    }
    if (closest && closest.distanceMiles <= Number(radiusMiles)) {
      return {
        matched: true,
        matchType: "postcode_proximity",
        matchValue:
          closest.point.label ?? closest.point.postcode ?? `${closest.point.lat},${closest.point.lng}`,
      };
    }
  }
  const labelBlob = normalizeToken(`${String(event?.name ?? "")} ${venueName}`);
  const placeHit = watchlist.placeLabels.find((value) => labelBlob.includes(value));
  if (placeHit) {
    return { matched: true, matchType: "place_alias", matchValue: placeHit };
  }
  return { matched: false, matchType: "none", matchValue: null };
}

function normalizeLowerList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeToken(value))
        .filter(Boolean),
    ),
  );
}

function normalizeRawList(values) {
  const map = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!map.has(key)) {
      map.set(key, trimmed);
    }
  }
  return Array.from(map.values());
}

function normalizePoints(values) {
  const points = [];
  for (const raw of Array.isArray(values) ? values : []) {
    if (!raw || typeof raw !== "object") continue;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({
      label: String(raw.label ?? "").trim() || null,
      lat,
      lng,
      postcode: String(raw.postcode ?? "").trim().toUpperCase() || null,
      outwardCode: deriveOutwardCode(String(raw.outwardCode ?? raw.postcode ?? "")),
    });
  }
  return points;
}

function normalizeUpperList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function deriveOutwardCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) return "";
  const match = normalized.match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return match ? match[1] : "";
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

module.exports = {
  createTicketmasterSignalProvider,
};
