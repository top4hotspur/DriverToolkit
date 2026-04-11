const { listProviderRegistry } = require("./signalProviderRegistry");
const { listRolloutRules, resolveActiveProvidersForLocation } = require("./signalRolloutRules");

const PROVIDER_TIMEOUT_MS = 6500;
const NORMALIZED_CACHE_TTL_MS = 5 * 60 * 1000;
const DIARY_CACHE_TTL_MS = 3 * 60 * 1000;

const normalizedCache = new Map();
const diaryCache = new Map();
const FAVOURITES_FILTER_VERSION = "fav-hard-v4-single-diary-cache";

function normalizeRegionKey(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw) return raw;
  return "uk-ni";
}

function inferRegionFromPostcode(postcode) {
  const normalized = String(postcode ?? "").trim().toUpperCase();
  if (normalized.startsWith("BT")) return "uk-ni";
  return "global";
}

function createSignalPlatform(options) {
  const { translinkProvider, sportsProvider, ticketmasterProvider, adminConfig } = options;

  async function buildNormalizedSignals(query = {}, context = { endpoint: "unknown" }) {
    const loadStartMs = Date.now();
    const regionKey = normalizeRegionKey(query.regionKey ?? inferRegionFromPostcode(query.postcode));
    const country = String(query.country ?? "GB").toUpperCase();
    const city = String(query.city ?? "").toLowerCase() || "belfast";
    const favouritesWatchlist = normalizeFavouritesWatchlist(query);
    const favouritesWatchlistSignature = buildFavouritesWatchlistSignature(favouritesWatchlist);
    const cacheKey = `${regionKey}:${country}:${city}:${favouritesWatchlistSignature}`;
    console.log(`[DIARY][load] start endpoint=${context.endpoint} date=${String(query.date ?? "n/a")} region=${regionKey}`);
    console.log(
      `[FAVOURITES][watchlist] endpoint=${context.endpoint} venues=${favouritesWatchlist.venueNames.length} places=${favouritesWatchlist.placeLabels.length} postcodes=${favouritesWatchlist.postcodes.length} outward=${favouritesWatchlist.outwardCodes.length} broadCities=${favouritesWatchlist.broadCities.length} allowBroadCity=${String(favouritesWatchlist.allowBroadCity)}`,
    );

    const cachedNormalized = normalizedCache.get(cacheKey);
    const cacheAgeMs = cachedNormalized ? Date.now() - cachedNormalized.cachedAtMs : Number.POSITIVE_INFINITY;

    const rollout = resolveActiveProvidersForLocation({ country, regionKey, city });
    const providerRegistry = listProviderRegistry();
    const enabledProviderKeys = new Set(rollout.activeProviderKeys);

    const providerOutputs = [];
    const providerStats = [];
    const sportsDiagnostics = {
      providerStatus: "not_requested",
      sportsFetchedCount: 0,
      sportsNormalizedCount: 0,
      sportsIncludedCount: 0,
      sportsExcludedCount: 0,
      sportsExcludedNotInFavouritesCount: 0,
      exclusionReasons: [],
      leaguesQueried: [],
      sportsQueried: [],
    };
    const eventsDiagnostics = {
      providerStatus: "not_requested",
      eventsFetchedCount: 0,
      eventsNormalizedCount: 0,
      eventsIncludedCount: 0,
      eventsExcludedCount: 0,
      eventsExcludedNotInFavouritesCount: 0,
      exclusionReasons: [],
      venuesQueried: [],
      countriesQueried: [],
    };
    let translinkDiaryDebug = null;
    if (enabledProviderKeys.has("translink")) {
      const providerStartMs = Date.now();
      console.log("[DIARY][provider] start provider=translink");
      try {
        const translinkResult = await withTimeout(
          translinkProvider.collectSignals({
            now: query.now,
            lat: query.lat,
            lng: query.lng,
            radiusMiles: query.radiusMiles,
            regionKey,
            mode: context.endpoint,
            date: typeof query.date === "string" ? query.date : undefined,
            favouritesWatchlist,
          }),
          PROVIDER_TIMEOUT_MS,
          "translink_timeout",
        );
        const durationMs = Date.now() - providerStartMs;
        const count = Array.isArray(translinkResult?.signals) ? translinkResult.signals.length : 0;
        console.log(`[DIARY][provider] success provider=translink durationMs=${durationMs} count=${count}`);
        if (context.endpoint === "diary" && translinkResult?.diaryDebug) {
          translinkDiaryDebug = translinkResult.diaryDebug;
        }
        providerOutputs.push(...(translinkResult?.signals ?? []));
        providerStats.push({
          providerKey: "translink",
          status: "success",
          durationMs,
          count,
        });
      } catch (error) {
        const durationMs = Date.now() - providerStartMs;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[DIARY][provider] fail provider=translink durationMs=${durationMs} error=${errorMessage}`);
        providerStats.push({
          providerKey: "translink",
          status: "failed",
          durationMs,
          count: 0,
          error: errorMessage,
        });
      }
    }
    if (enabledProviderKeys.has("sportsdb") && sportsProvider) {
      const providerStartMs = Date.now();
      console.log("[SPORTS][fetch] provider-start");
      try {
        const sportsResult = await withTimeout(
          sportsProvider.collectSignals({
            now: query.now,
            lat: query.lat,
            lng: query.lng,
            radiusMiles: query.radiusMiles,
            regionKey,
            country,
            city,
            cityExplicit: typeof query.city === "string" && query.city.trim().length > 0,
            mode: context.endpoint,
            date: typeof query.date === "string" ? query.date : undefined,
            favouritesWatchlist,
          }),
          PROVIDER_TIMEOUT_MS,
          "sportsdb_timeout",
        );
        const durationMs = Date.now() - providerStartMs;
        const count = Array.isArray(sportsResult?.signals) ? sportsResult.signals.length : 0;
        console.log(`[SPORTS][signals] provider-success durationMs=${durationMs} count=${count}`);
        providerOutputs.push(...(sportsResult?.signals ?? []));
        providerStats.push({
          providerKey: "sportsdb",
          status: "success",
          durationMs,
          count,
        });
        if (sportsResult?.diagnostics && typeof sportsResult.diagnostics === "object") {
          Object.assign(sportsDiagnostics, sportsResult.diagnostics);
        }
      } catch (error) {
        const durationMs = Date.now() - providerStartMs;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[SPORTS][signals] provider-fail durationMs=${durationMs} error=${errorMessage}`);
        providerStats.push({
          providerKey: "sportsdb",
          status: "failed",
          durationMs,
          count: 0,
          error: errorMessage,
        });
        sportsDiagnostics.providerStatus = "failed";
      }
    }
    if (enabledProviderKeys.has("ticketmaster") && ticketmasterProvider) {
      const providerStartMs = Date.now();
      console.log("[EVENTS][fetch] provider-start");
      try {
        const eventsResult = await withTimeout(
          ticketmasterProvider.collectSignals({
            now: query.now,
            lat: query.lat,
            lng: query.lng,
            radiusMiles: query.radiusMiles,
            regionKey,
            country,
            city,
            cityExplicit: typeof query.city === "string" && query.city.trim().length > 0,
            mode: context.endpoint,
            date: typeof query.date === "string" ? query.date : undefined,
            favouritesWatchlist,
          }),
          PROVIDER_TIMEOUT_MS,
          "ticketmaster_timeout",
        );
        const durationMs = Date.now() - providerStartMs;
        const count = Array.isArray(eventsResult?.signals) ? eventsResult.signals.length : 0;
        console.log(`[EVENTS][signals] provider-success durationMs=${durationMs} count=${count}`);
        providerOutputs.push(...(eventsResult?.signals ?? []));
        providerStats.push({
          providerKey: "ticketmaster",
          status: "success",
          durationMs,
          count,
        });
        if (eventsResult?.diagnostics && typeof eventsResult.diagnostics === "object") {
          Object.assign(eventsDiagnostics, eventsResult.diagnostics);
        }
      } catch (error) {
        const durationMs = Date.now() - providerStartMs;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[EVENTS][signals] provider-fail durationMs=${durationMs} error=${errorMessage}`);
        providerStats.push({
          providerKey: "ticketmaster",
          status: "failed",
          durationMs,
          count: 0,
          error: errorMessage,
        });
        eventsDiagnostics.providerStatus = "failed";
      }
    }

    const freshSignals = providerOutputs
      .filter((signal) => signal.regionKey === regionKey)
      .sort((a, b) => priorityWeight(b) - priorityWeight(a) || Date.parse(a.startsAt) - Date.parse(b.startsAt));

    const allowNormalizedCacheFallback = context.endpoint !== "diary";
    let signals = freshSignals;
    let cacheSource = "live";
    if (
      allowNormalizedCacheFallback &&
      freshSignals.length === 0 &&
      cachedNormalized &&
      cacheAgeMs <= NORMALIZED_CACHE_TTL_MS
    ) {
      signals = cachedNormalized.signals;
      cacheSource = "cached";
    }

    if (freshSignals.length > 0) {
      normalizedCache.set(cacheKey, {
        cachedAtMs: Date.now(),
        generatedAt: new Date().toISOString(),
        signals: freshSignals,
      });
    }

    const totalDurationMs = Date.now() - loadStartMs;
    console.log(`[DIARY][load] complete endpoint=${context.endpoint} durationMs=${totalDurationMs} totalCount=${signals.length}`);
    return {
      generatedAt: new Date().toISOString(),
      regionKey,
      rollout,
      meta: {
        cacheSource,
        normalizedCacheAllowed: allowNormalizedCacheFallback,
        providerStats,
        durationMs: totalDurationMs,
        diaryDebug: context.endpoint === "diary" ? translinkDiaryDebug : null,
        sportsDiagnostics,
        sportsFetchedCount: Number(sportsDiagnostics.sportsFetchedCount ?? 0),
        sportsNormalizedCount: Number(sportsDiagnostics.sportsNormalizedCount ?? 0),
        sportsIncludedCount: Number(sportsDiagnostics.sportsIncludedCount ?? 0),
        sportsExcludedCount: Number(sportsDiagnostics.sportsExcludedCount ?? 0),
        sportsExclusionReasons: Array.isArray(sportsDiagnostics.exclusionReasons)
          ? sportsDiagnostics.exclusionReasons
          : [],
        sportsProviderStatus: String(sportsDiagnostics.providerStatus ?? "unknown"),
        sportsLeaguesQueried: Array.isArray(sportsDiagnostics.leaguesQueried)
          ? sportsDiagnostics.leaguesQueried
          : [],
        sportsSportsQueried: Array.isArray(sportsDiagnostics.sportsQueried)
          ? sportsDiagnostics.sportsQueried
          : [],
        eventsDiagnostics,
        eventsFetchedCount: Number(eventsDiagnostics.eventsFetchedCount ?? 0),
        eventsNormalizedCount: Number(eventsDiagnostics.eventsNormalizedCount ?? 0),
        eventsIncludedCount: Number(eventsDiagnostics.eventsIncludedCount ?? 0),
        eventsExcludedCount: Number(eventsDiagnostics.eventsExcludedCount ?? 0),
        eventsExclusionReasons: Array.isArray(eventsDiagnostics.exclusionReasons)
          ? eventsDiagnostics.exclusionReasons
          : [],
        eventsProviderStatus: String(eventsDiagnostics.providerStatus ?? "unknown"),
        eventsVenuesQueried: Array.isArray(eventsDiagnostics.venuesQueried)
          ? eventsDiagnostics.venuesQueried
          : [],
        eventsCountriesQueried: Array.isArray(eventsDiagnostics.countriesQueried)
          ? eventsDiagnostics.countriesQueried
          : [],
        favouritesWatchlistCount:
          favouritesWatchlist.venueNames.length +
          favouritesWatchlist.placeLabels.length +
          favouritesWatchlist.postcodes.length +
          favouritesWatchlist.outwardCodes.length +
          favouritesWatchlist.broadCities.length +
          favouritesWatchlist.points.length,
        favouriteWatchlistSummary: {
          venueNames: favouritesWatchlist.venueNames.slice(0, 20),
          placeLabels: favouritesWatchlist.placeLabels.slice(0, 20),
          postcodes: favouritesWatchlist.postcodes.slice(0, 20),
          outwardCodes: favouritesWatchlist.outwardCodes.slice(0, 20),
          broadCities: favouritesWatchlist.broadCities.slice(0, 20),
          points: favouritesWatchlist.points.slice(0, 20).map((point) => ({
            lat: Number(point.lat.toFixed(4)),
            lng: Number(point.lng.toFixed(4)),
            outwardCode: point.outwardCode ?? null,
          })),
          allowBroadCity: favouritesWatchlist.allowBroadCity,
        },
        sportsExcludedNotInFavouritesCount: Number(sportsDiagnostics.sportsExcludedNotInFavouritesCount ?? 0),
        eventsExcludedNotInFavouritesCount: Number(eventsDiagnostics.eventsExcludedNotInFavouritesCount ?? 0),
        favouritesSignatureUsedInCacheKey: favouritesWatchlistSignature,
        favouritesFilterVersion: FAVOURITES_FILTER_VERSION,
      },
      providerRegistry: providerRegistry.map((provider) => ({
        ...provider,
        enabled: isProviderEnabled(provider, adminConfig),
      })),
      trackedPlaces: translinkProvider.getTrackedHubs(),
      signals,
    };
  }

  async function buildHomePayload(query = {}) {
    const payload = await buildNormalizedSignals(query, { endpoint: "home" });
    const radiusFiltered = applyRadiusEligibility(payload.signals, query, "home", {
      hardFilter: false,
    });
    const lifecycle = applyLifecycleFiltering(radiusFiltered.items, {
      endpoint: "home",
      includeExpired: false,
    });
    const favouritesFiltered = applyFavouritesHardInclusion(lifecycle.items, "home");
    const now = Date.now();
    const nextTwoHours = now + 2 * 60 * 60 * 1000;
    const items = favouritesFiltered.items.filter((signal) => {
      const startMs = Date.parse(signal.startsAt);
      return !Number.isNaN(startMs) && startMs >= now - 10 * 60 * 1000 && startMs <= nextTwoHours;
    });
    return {
      generatedAt: payload.generatedAt,
      regionKey: payload.regionKey,
      rollout: payload.rollout,
      meta: {
        ...payload.meta,
        radiusDiagnostics: radiusFiltered.meta,
        lifecycleDiagnostics: lifecycle.meta,
        favouritesDiagnostics: favouritesFiltered.meta,
        sportsIncludedByFavouritesCount: favouritesFiltered.meta.sportsIncludedByFavouritesCount,
        sportsExcludedNotInFavouritesCount:
          Number(payload.meta?.sportsExcludedNotInFavouritesCount ?? 0) +
          favouritesFiltered.meta.sportsExcludedNotInFavouritesCount,
        eventsIncludedByFavouritesCount: favouritesFiltered.meta.eventsIncludedByFavouritesCount,
        eventsExcludedNotInFavouritesCount:
          Number(payload.meta?.eventsExcludedNotInFavouritesCount ?? 0) +
          favouritesFiltered.meta.eventsExcludedNotInFavouritesCount,
      },
      items: sortByLifecycleThenTime(items).slice(0, 20),
    };
  }

  async function buildDiaryPayload(query = {}) {
    const date = String(query.date ?? "").trim();
    const regionKey = normalizeRegionKey(query.regionKey ?? inferRegionFromPostcode(query.postcode));
    const country = String(query.country ?? "GB").toUpperCase();
    const city = String(query.city ?? "").toLowerCase() || "belfast";
    const favouritesWatchlist = normalizeFavouritesWatchlist(query);
    const favouritesWatchlistSignature = buildFavouritesWatchlistSignature(favouritesWatchlist);
    const diaryScopeSignature = buildDiaryScopeSignature(query);
    const diaryCacheKey = `${regionKey}:${country}:${city}:${date || "all"}:${diaryScopeSignature}:${favouritesWatchlistSignature}:${FAVOURITES_FILTER_VERSION}`;
    const cachedDiary = diaryCache.get(diaryCacheKey);
    const cachedAgeMs = cachedDiary ? Date.now() - cachedDiary.cachedAtMs : Number.POSITIVE_INFINITY;
    const cachedDiaryVersion = String(cachedDiary?.cacheVersion ?? "");
    const cachedDiaryIsCurrent =
      cachedDiaryVersion === FAVOURITES_FILTER_VERSION &&
      cachedDiary?.cacheWrittenAfterFinalFilter === true;
    if (cachedDiary && !cachedDiaryIsCurrent) {
      diaryCache.delete(diaryCacheKey);
      console.log(
        `[DIARY][cache] evict key=${diaryCacheKey} reason=legacy_cache_entry cacheVersion=${cachedDiaryVersion || "none"} expectedVersion=${FAVOURITES_FILTER_VERSION} cacheWrittenAfterFinalFilter=${String(
          cachedDiary?.cacheWrittenAfterFinalFilter === true,
        )}`,
      );
    }
    if (cachedDiary && cachedDiaryIsCurrent && cachedAgeMs <= DIARY_CACHE_TTL_MS) {
      console.log(
        `[DIARY][cache] hit key=${diaryCacheKey} version=${FAVOURITES_FILTER_VERSION} favouritesSignature=${favouritesWatchlistSignature} scope=${diaryScopeSignature} ageMs=${Math.round(
          cachedAgeMs,
        )} cacheWrittenAfterFinalFilter=${String(cachedDiary.cacheWrittenAfterFinalFilter === true)}`,
      );
      const lifecycle = applyLifecycleFiltering(cachedDiary.items ?? [], {
        endpoint: "diary-cache",
        includeExpired: false,
      });
      const sortedCachedItems = lifecycle.items.sort(
        (a, b) =>
          lifecycleRank(a) - lifecycleRank(b) ||
          diaryPriorityWeight(b) - diaryPriorityWeight(a) ||
          Date.parse(a.startsAt) - Date.parse(b.startsAt),
      );
      console.log(`[DIARY][load] complete endpoint=diary durationMs=1 totalCount=${cachedDiary.items.length}`);
      return {
        generatedAt: cachedDiary.generatedAt,
        regionKey: cachedDiary.regionKey,
        rollout: cachedDiary.rollout,
        meta: {
          cacheSource: "diary-cache",
          cacheHit: true,
          cacheKey: diaryCacheKey,
          cacheVersion: FAVOURITES_FILTER_VERSION,
          cacheDateKey: date || null,
          cacheGeneratedAt: cachedDiary.generatedAt,
          freshFetchUsed: false,
          favouritesSignatureUsedInCacheKey: favouritesWatchlistSignature,
          favouritesSignature: favouritesWatchlistSignature,
          favouritesFilterVersion: FAVOURITES_FILTER_VERSION,
          cacheIncludesUnmatchedSportsCount: countUnmatchedSportsOrEvents(cachedDiary.items ?? []),
          cacheWrittenAfterFinalFilter: cachedDiary.cacheWrittenAfterFinalFilter === true,
          providerStats: cachedDiary.providerStats ?? [],
          durationMs: 1,
          lifecycleDiagnostics: lifecycle.meta,
        },
        items: sortedCachedItems,
      };
    }

    const payload = await buildNormalizedSignals(query, { endpoint: "diary" });
    const radiusFiltered = applyRadiusEligibility(payload.signals, query, "diary", {
      hardFilter: false,
    });
    const lifecycle = applyLifecycleFiltering(radiusFiltered.items, {
      endpoint: "diary",
      includeExpired: false,
    });
    const favouritesFiltered = applyFavouritesHardInclusion(lifecycle.items, "diary");
    let items = favouritesFiltered.items.filter((signal) => signal.signalType !== "proximity_alert");
    if (!date) {
      items = items;
    } else {
      const dayWindow = toLocalDayWindow(date);
      const start = dayWindow ? dayWindow.startMs : Number.NaN;
      const end = dayWindow ? dayWindow.endMs : Number.NaN;
      items = items.filter((signal) => {
        const startMs = Date.parse(signal.startsAt);
        return !Number.isNaN(startMs) && startMs >= start && startMs <= end;
      });
    }
    items = items.sort(
      (a, b) =>
        lifecycleRank(a) - lifecycleRank(b) ||
        diaryPriorityWeight(b) - diaryPriorityWeight(a) ||
        Date.parse(a.startsAt) - Date.parse(b.startsAt),
    );
    diaryCache.set(diaryCacheKey, {
      cachedAtMs: Date.now(),
      generatedAt: payload.generatedAt,
      regionKey: payload.regionKey,
      rollout: payload.rollout,
      items,
      providerStats: payload.meta?.providerStats ?? [],
      cacheKey: diaryCacheKey,
      cacheVersion: FAVOURITES_FILTER_VERSION,
      favouritesSignatureUsedInCacheKey: favouritesWatchlistSignature,
      cacheWrittenAfterFinalFilter: true,
    });
    console.log(
      `[DIARY][cache] write key=${diaryCacheKey} version=${FAVOURITES_FILTER_VERSION} favouritesSignature=${favouritesWatchlistSignature} scope=${diaryScopeSignature} cacheWrittenAfterFinalFilter=true items=${items.length}`,
    );
    return {
      generatedAt: payload.generatedAt,
      regionKey: payload.regionKey,
      rollout: payload.rollout,
      meta: {
        ...payload.meta,
        cacheHit: false,
        cacheKey: diaryCacheKey,
        cacheVersion: FAVOURITES_FILTER_VERSION,
        cacheDateKey: date || null,
        cacheGeneratedAt: null,
        freshFetchUsed: true,
        favouritesSignatureUsedInCacheKey: favouritesWatchlistSignature,
        favouritesSignature: favouritesWatchlistSignature,
        favouritesFilterVersion: FAVOURITES_FILTER_VERSION,
        cacheIncludesUnmatchedSportsCount: countUnmatchedSportsOrEvents(items),
        cacheWrittenAfterFinalFilter: true,
        radiusDiagnostics: radiusFiltered.meta,
        lifecycleDiagnostics: lifecycle.meta,
        favouritesDiagnostics: favouritesFiltered.meta,
        sportsDiaryIncludedCount: items.filter((item) => item.providerKey === "sportsdb").length,
        sportsDiaryExcludedCount:
          Math.max(
            0,
            Number(payload.meta?.sportsIncludedCount ?? 0) -
              items.filter((item) => item.providerKey === "sportsdb").length,
          ),
        sportsIncludedByFavouritesCount: favouritesFiltered.meta.sportsIncludedByFavouritesCount,
        sportsExcludedNotInFavouritesCount:
          Number(payload.meta?.sportsExcludedNotInFavouritesCount ?? 0) +
          favouritesFiltered.meta.sportsExcludedNotInFavouritesCount,
        eventsIncludedByFavouritesCount: favouritesFiltered.meta.eventsIncludedByFavouritesCount,
        eventsExcludedNotInFavouritesCount:
          Number(payload.meta?.eventsExcludedNotInFavouritesCount ?? 0) +
          favouritesFiltered.meta.eventsExcludedNotInFavouritesCount,
      },
      items: items.map((item) => {
        if (item.providerKey !== "sportsdb") return item;
        const diaryGroupDateLocal = toLocalDateKey(item.startsAt);
        const diaryGroupDateUtc = toUtcDateKey(item.startsAt);
        if (isWindsorSignal(item)) {
          console.log(
            `[SPORTS][filter][windsor] endpoint=diary lifecycle=${item.metadata?.lifecycleStatus ?? "n/a"} selectedDate=${date || "all"} localDateGroup=${diaryGroupDateLocal ?? "n/a"} utcDateGroup=${diaryGroupDateUtc ?? "n/a"} included=true startsAt=${item.startsAt} endsAt=${item.endsAt}`,
          );
        }
        return {
          ...item,
          metadata: {
            ...(item.metadata ?? {}),
            includedInDiary: true,
            includedInProximity: false,
            filteredOutReason: null,
            diarySelectedDate: date || null,
            diaryGroupDateLocal,
            diaryGroupDateUtc,
          },
        };
      }),
    };
  }

  async function buildProximityPayload(query = {}) {
    const payload = await buildNormalizedSignals(query, { endpoint: "proximity" });
    const radiusFiltered = applyRadiusEligibility(payload.signals, query, "proximity", {
      hardFilter: true,
    });
    const lifecycle = applyLifecycleFiltering(radiusFiltered.items, {
      endpoint: "proximity",
      includeExpired: false,
    });
    const favouritesFiltered = applyFavouritesHardInclusion(lifecycle.items, "proximity");
    const nowMs = Date.now();
    const nextThreeHoursMs = nowMs + 3 * 60 * 60 * 1000;
    const items = favouritesFiltered.items
      .filter((item) => {
        const startMs = Date.parse(item.startsAt);
        if (Number.isNaN(startMs)) {
          return false;
        }
        return startMs >= nowMs - 20 * 60 * 1000 && startMs <= nextThreeHoursMs;
      })
      .filter((item) =>
        item.signalType === "proximity_alert" ||
        item.signalType === "cancellation" ||
        item.signalType === "transport_disruption" ||
        item.signalType === "transport_very_busy" ||
        item.signalType === "transport_busy" ||
        item.signalType === "sports_pre_event_arrivals" ||
        item.signalType === "sports_post_event_dispersal" ||
        item.signalType === "events_pre_arrivals" ||
        item.signalType === "events_post_dispersal",
      )
      .sort(
        (a, b) =>
          proximityPriorityWeight(b) - proximityPriorityWeight(a) ||
          Date.parse(a.startsAt) - Date.parse(b.startsAt),
      );
    return {
      generatedAt: payload.generatedAt,
      regionKey: payload.regionKey,
      rollout: payload.rollout,
      meta: {
        ...payload.meta,
        radiusDiagnostics: radiusFiltered.meta,
        lifecycleDiagnostics: lifecycle.meta,
        favouritesDiagnostics: favouritesFiltered.meta,
        sportsProximityIncludedCount: items.filter((item) => item.providerKey === "sportsdb").length,
        sportsProximityExcludedCount:
          Math.max(
            0,
            Number(payload.meta?.sportsIncludedCount ?? 0) -
              items.filter((item) => item.providerKey === "sportsdb").length,
          ),
        sportsIncludedByFavouritesCount: favouritesFiltered.meta.sportsIncludedByFavouritesCount,
        sportsExcludedNotInFavouritesCount:
          Number(payload.meta?.sportsExcludedNotInFavouritesCount ?? 0) +
          favouritesFiltered.meta.sportsExcludedNotInFavouritesCount,
        eventsIncludedByFavouritesCount: favouritesFiltered.meta.eventsIncludedByFavouritesCount,
        eventsExcludedNotInFavouritesCount:
          Number(payload.meta?.eventsExcludedNotInFavouritesCount ?? 0) +
          favouritesFiltered.meta.eventsExcludedNotInFavouritesCount,
      },
      items: items
        .map((item) => {
          if (item.providerKey !== "sportsdb") return item;
          if (isWindsorSignal(item)) {
            console.log(
              `[SPORTS][filter][windsor] endpoint=proximity withinRadius=${String(
                item.metadata?.withinRadius ?? "n/a",
              )} promotionEligible=${String(item.metadata?.promotionEligible ?? "n/a")} included=true`,
            );
          }
          return {
            ...item,
            metadata: {
              ...(item.metadata ?? {}),
              includedInDiary: false,
              includedInProximity: true,
            },
          };
        })
        .slice(0, 8),
    };
  }

  return {
    getProviderRegistry: listProviderRegistry,
    getRolloutRules: listRolloutRules,
    getTrackedPlaces: translinkProvider.getTrackedHubs,
    buildNormalizedSignals,
    buildHomePayload,
    buildDiaryPayload,
    buildProximityPayload,
    getCacheVersion: () => FAVOURITES_FILTER_VERSION,
    clearCaches: () => {
      const normalizedEntries = normalizedCache.size;
      const diaryEntries = diaryCache.size;
      normalizedCache.clear();
      diaryCache.clear();
      return {
        normalizedEntriesCleared: normalizedEntries,
        diaryEntriesCleared: diaryEntries,
      };
    },
    getCacheStats: () => ({
      normalizedEntries: normalizedCache.size,
      diaryEntries: diaryCache.size,
      cacheVersion: FAVOURITES_FILTER_VERSION,
    }),
  };
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lng2 - lng1) * p))) / 2;
  return 7917.5117 * Math.asin(Math.sqrt(a));
}

function withRadiusDiagnostics(signal, diagnostics) {
  const metadata = signal?.metadata && typeof signal.metadata === "object" ? signal.metadata : {};
  const upstreamPromotionEligible = metadata.promotionEligible !== false;
  const computedPromotionEligible =
    diagnostics.withinRadius === true &&
    diagnostics.filteredOutReason == null &&
    upstreamPromotionEligible;
  return {
    ...signal,
    metadata: {
      ...metadata,
      configuredRadiusMiles: diagnostics.configuredRadiusMiles,
      distanceMiles: diagnostics.distanceMiles,
      withinRadius: diagnostics.withinRadius,
      eligibilityReason: diagnostics.eligibilityReason,
      filteredOutReason: diagnostics.filteredOutReason,
      promotionEligible: computedPromotionEligible,
    },
  };
}

function applyRadiusEligibility(signals, query, endpointLabel, options = { hardFilter: true }) {
  const hardFilter = options.hardFilter !== false;
  const configuredRadiusMiles = toFiniteNumber(query?.radiusMiles);
  const lat = toFiniteNumber(query?.lat);
  const lng = toFiniteNumber(query?.lng);
  if (!Number.isFinite(configuredRadiusMiles) || configuredRadiusMiles <= 0) {
    const passthrough = Array.isArray(signals)
      ? signals.map((signal) =>
          withRadiusDiagnostics(signal, {
            configuredRadiusMiles: null,
            distanceMiles: null,
            withinRadius: true,
            eligibilityReason: "radius_not_configured",
            filteredOutReason: null,
            promotionEligible: true,
          }),
        )
      : [];
    return {
      items: passthrough,
      meta: {
        configuredRadiusMiles: null,
        includedCount: passthrough.length,
        excludedCount: 0,
        excluded: [],
        rule: "radius_not_configured",
      },
    };
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!hardFilter) {
      const annotated = (Array.isArray(signals) ? signals : []).map((signal) =>
        withRadiusDiagnostics(signal, {
          configuredRadiusMiles,
          distanceMiles: null,
          withinRadius: null,
          eligibilityReason: "missing_driver_coords",
          filteredOutReason: "missing_driver_coords",
          promotionEligible: false,
        }),
      );
      return {
        items: annotated,
        meta: {
          configuredRadiusMiles,
          includedCount: annotated.length,
          excludedCount: 0,
          excluded: [],
          rule: "annotate_only_missing_coords",
        },
      };
    }
    const excluded = (Array.isArray(signals) ? signals : []).map((signal) => ({
      id: signal.id,
      label: signal.title ?? signal.location?.name ?? signal.locationId ?? "unknown",
      filteredOutReason: "missing_driver_coords",
    }));
    console.log(
      `[RADIUS][signals] endpoint=${endpointLabel} configuredRadiusMiles=${configuredRadiusMiles.toFixed(
        3,
      )} included=0 excluded=${excluded.length} reason=missing_driver_coords`,
    );
    return {
      items: [],
      meta: {
        configuredRadiusMiles,
        includedCount: 0,
        excludedCount: excluded.length,
        excluded,
        rule: "hard_filter_missing_coords_excludes_all",
      },
    };
  }

  const included = [];
  const excluded = [];
  for (const signal of Array.isArray(signals) ? signals : []) {
    const location = signal?.location && typeof signal.location === "object" ? signal.location : {};
    const signalLat = toFiniteNumber(location.lat);
    const signalLng = toFiniteNumber(location.lng);
    if (!Number.isFinite(signalLat) || !Number.isFinite(signalLng)) {
      const missingCoordsDiagnostics = {
        configuredRadiusMiles,
        distanceMiles: null,
        withinRadius: false,
        eligibilityReason: "missing_signal_coords",
        filteredOutReason: "missing_signal_coords",
        promotionEligible: false,
      };
      if (!hardFilter) {
        included.push(withRadiusDiagnostics(signal, missingCoordsDiagnostics));
        continue;
      }
      excluded.push({
        id: signal.id,
        label: signal.title ?? location.name ?? "unknown",
        filteredOutReason: "missing_signal_coords",
      });
      continue;
    }
    const distanceMiles = haversineMiles(lat, lng, signalLat, signalLng);
    const withinRadius = distanceMiles <= configuredRadiusMiles;
    const baseDiagnostics = {
      configuredRadiusMiles,
      distanceMiles: Number(distanceMiles.toFixed(3)),
      withinRadius,
      eligibilityReason: withinRadius ? "within_radius" : "outside_radius",
      filteredOutReason: withinRadius ? null : "outside_radius",
      promotionEligible: withinRadius,
    };
    if (!withinRadius && hardFilter) {
      excluded.push({
        id: signal.id,
        label: signal.title ?? location.name ?? "unknown",
        filteredOutReason: "outside_radius",
        distanceMiles: baseDiagnostics.distanceMiles,
      });
      continue;
    }
    included.push(withRadiusDiagnostics(signal, baseDiagnostics));
  }
  console.log(
    `[RADIUS][signals] endpoint=${endpointLabel} configuredRadiusMiles=${configuredRadiusMiles.toFixed(
      3,
    )} included=${included.length} excluded=${excluded.length}`,
  );
  return {
    items: included,
    meta: {
      configuredRadiusMiles,
      includedCount: included.length,
      excludedCount: excluded.length,
      excluded,
      rule: hardFilter ? "distanceMiles <= configuredRadiusMiles" : "annotate_distance_eligibility_only",
    },
  };
}

function isProviderEnabled(provider, adminConfig) {
  const admin = adminConfig?.get?.() ?? {};
  const configured = admin.providers?.[provider.providerKey]?.enabled;
  if (typeof configured === "boolean") {
    return configured;
  }
  return provider.enabled === true;
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
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function toLocalDateKey(value) {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toUtcDateKey(value) {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = `${parsed.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeFavouritesWatchlist(query) {
  const venueNames = normalizeStringList(readQueryList(query, "favVenue"));
  const placeLabels = normalizeStringList(readQueryList(query, "favPlace"));
  const postcodes = normalizePostcodeList(readQueryList(query, "favPostcode"));
  const outwardCodes = normalizeOutwardList(readQueryList(query, "favOutward"));
  const broadCities = normalizeStringList(readQueryList(query, "favBroadCity"));
  const points = normalizeFavouritePoints(readQueryList(query, "favPoint"));
  const allowBroadCity = String(query?.favAllowBroadCity ?? "")
    .trim()
    .toLowerCase();
  return {
    venueNames,
    placeLabels,
    postcodes,
    outwardCodes,
    broadCities,
    points,
    allowBroadCity: allowBroadCity === "1" || allowBroadCity === "true" || allowBroadCity === "yes",
  };
}

function buildFavouritesWatchlistSignature(watchlist) {
  const payload = [
    ...watchlist.venueNames,
    ...watchlist.placeLabels,
    ...watchlist.postcodes,
    ...watchlist.outwardCodes,
    ...watchlist.broadCities,
    ...watchlist.points.map((point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`),
    watchlist.allowBroadCity ? "allow-city" : "no-city",
  ].join("|");
  return payload || "none";
}

function buildDiaryScopeSignature(query) {
  const radius = toFiniteNumber(query?.radiusMiles);
  const lat = toFiniteNumber(query?.lat);
  const lng = toFiniteNumber(query?.lng);
  const postcode = String(query?.postcode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const latBucket = Number.isFinite(lat) ? Number(lat.toFixed(3)) : "none";
  const lngBucket = Number.isFinite(lng) ? Number(lng.toFixed(3)) : "none";
  const radiusBucket = Number.isFinite(radius) ? Number(radius.toFixed(3)) : "none";
  return `pc=${postcode || "none"}|lat=${latBucket}|lng=${lngBucket}|r=${radiusBucket}`;
}

function readQueryList(query, key) {
  const raw = query?.[key];
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value ?? ""));
  }
  if (typeof raw === "string") {
    return [raw];
  }
  return [];
}

function normalizeStringList(values) {
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

function normalizePostcodeList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function normalizeOutwardList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean)
        .map((value) => deriveOutwardCode(value))
        .filter(Boolean),
    ),
  );
}

function deriveOutwardCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized) return "";
  const fullPostcodeMatch = normalized.match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  if (fullPostcodeMatch) {
    return fullPostcodeMatch[1];
  }
  const outwardMatch = normalized.match(/^[A-Z]{1,2}\d[A-Z\d]?/);
  if (outwardMatch) {
    return outwardMatch[0];
  }
  return normalized;
}

function normalizeFavouritePoints(values) {
  const points = [];
  for (const raw of Array.isArray(values) ? values : []) {
    try {
      const parsed = JSON.parse(String(raw ?? ""));
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const lat = Number(parsed.lat);
      const lng = Number(parsed.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }
      points.push({
        label: String(parsed.label ?? "").trim() || null,
        lat,
        lng,
        postcode: String(parsed.postcode ?? "").trim().toUpperCase() || null,
        outwardCode: deriveOutwardCode(String(parsed.outwardCode ?? parsed.postcode ?? "")),
      });
    } catch {
      // ignore malformed point entries
    }
  }
  return points;
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function priorityWeight(item) {
  if (item.signalType === "cancellation") return 800;
  if (item.signalType === "transport_disruption") return 780;
  if (item.signalType === "transport_very_busy") return 600;
  if (item.signalType === "transport_busy") return 500;
  if (item.signalType === "sports_post_event_dispersal" || item.signalType === "events_post_dispersal") return 480;
  if (item.signalType === "sports_pre_event_arrivals" || item.signalType === "events_pre_arrivals") return 430;
  if (item.signalType === "proximity_alert") return 450;
  return 200;
}

function diaryPriorityWeight(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const isLiveException = metadata.isLiveException === true;
  const isBaseline = metadata.isBaseline === true;
  if (isLiveException && item.signalType === "cancellation") return 700;
  if (isLiveException && item.signalType === "transport_disruption") return 680;
  if (isBaseline && item.signalType === "transport_very_busy") return 420;
  if (isBaseline && item.signalType === "transport_busy") return 400;
  if (isBaseline && (item.signalType === "sports_post_event_dispersal" || item.signalType === "events_post_dispersal")) return 390;
  if (isBaseline && (item.signalType === "sports_pre_event_arrivals" || item.signalType === "events_pre_arrivals")) return 360;
  if (isBaseline) return 300;
  return priorityWeight(item);
}

function proximityPriorityWeight(item) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const isLiveException = metadata.isLiveException === true;
  const uplift = Number(metadata.upliftVsBaseline ?? 0);
  const derivedFromBaselineException =
    metadata.exceptionKind === "uplift_vs_baseline" || (Number.isFinite(uplift) && uplift > 0);

  if (isLiveException && (item.signalType === "cancellation" || item.signalType === "transport_disruption")) {
    return 1000;
  }
  if (isLiveException && derivedFromBaselineException) {
    return 900;
  }
  if (item.signalType === "transport_very_busy" || item.signalType === "transport_busy") {
    return 700;
  }
  if (
    item.signalType === "sports_post_event_dispersal" ||
    item.signalType === "events_post_dispersal" ||
    item.signalType === "sports_pre_event_arrivals" ||
    item.signalType === "events_pre_arrivals"
  ) {
    return 650;
  }
  if (item.signalType === "proximity_alert") {
    return 500;
  }
  return priorityWeight(item);
}

function applyLifecycleFiltering(signals, options = {}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const includeExpired = options.includeExpired === true;
  const endpoint = String(options.endpoint ?? "unknown");

  const items = [];
  const filteredOut = [];
  for (const signal of Array.isArray(signals) ? signals : []) {
    const lifecycleStatus = getLifecycleStatus(signal, nowMs);
    if (signal?.providerKey === "sportsdb" && isWindsorSignal(signal)) {
      console.log(
        `[SPORTS][filter][windsor] endpoint=${endpoint} lifecycle=${lifecycleStatus} startsAt=${signal?.startsAt ?? "n/a"} endsAt=${signal?.endsAt ?? "n/a"}`,
      );
    }
    const metadata = signal?.metadata && typeof signal.metadata === "object" ? signal.metadata : {};
    const annotated = {
      ...signal,
      metadata: {
        ...metadata,
        lifecycleStatus,
        lifecycleEvaluatedAt: nowIso,
      },
    };
    if (lifecycleStatus === "expired" && !includeExpired) {
      filteredOut.push({
        id: signal.id,
        startsAt: signal.startsAt ?? null,
        endsAt: signal.endsAt ?? null,
        lifecycleStatus,
        filteredOutReason: "expired_window",
      });
      continue;
    }
    items.push(annotated);
  }
  console.log(
    `[LIFECYCLE][signals] endpoint=${endpoint} nowIso=${nowIso} kept=${items.length} expiredFiltered=${filteredOut.length}`,
  );
  return {
    items,
    meta: {
      nowIso,
      keptCount: items.length,
      expiredFilteredCount: filteredOut.length,
      filteredOut,
      rule: "exclude signals where now >= endsAt (or startsAt when no endsAt)",
    },
  };
}

function applyFavouritesHardInclusion(signals, endpoint) {
  const allowedMatchTypes = new Set([
    "venue_name_exact",
    "venue_name_normalized",
    "place_alias",
    "postcode_exact",
    "outward_code",
    "postcode_proximity",
  ]);
  const items = [];
  const excluded = [];
  let sportsIncludedByFavouritesCount = 0;
  let sportsExcludedNotInFavouritesCount = 0;
  let eventsIncludedByFavouritesCount = 0;
  let eventsExcludedNotInFavouritesCount = 0;

  for (const signal of Array.isArray(signals) ? signals : []) {
    const providerKey = String(signal?.providerKey ?? "");
    const isSportsOrEvents = providerKey === "sportsdb" || providerKey === "ticketmaster";
    if (!isSportsOrEvents) {
      items.push(signal);
      continue;
    }
    const metadata = signal?.metadata && typeof signal.metadata === "object" ? signal.metadata : {};
    const favouriteMatched = metadata.favouriteMatched === true;
    const favouriteMatchType = String(metadata.favouriteMatchType ?? "none");
    const favouriteMatchValue = metadata.favouriteMatchValue ?? null;
    const include = favouriteMatched && allowedMatchTypes.has(favouriteMatchType);
    const venueLabel = String(
      metadata.venueName ?? signal?.location?.name ?? signal?.title ?? "unknown",
    );
    if (!include) {
      excluded.push({
        id: signal.id,
        providerKey,
        label: venueLabel,
        favouriteMatched,
        favouriteMatchType,
        favouriteMatchValue,
        filteredOutReason: "not_in_favourites",
      });
      if (providerKey === "sportsdb") {
        sportsExcludedNotInFavouritesCount += 1;
        console.log(
          `[SPORTS][favourites][exclude] endpoint=${endpoint} venue=${venueLabel} favouriteMatched=${String(
            favouriteMatched,
          )} favouriteMatchType=${favouriteMatchType} filteredOutReason=not_in_favourites`,
        );
      } else {
        eventsExcludedNotInFavouritesCount += 1;
        console.log(
          `[EVENTS][favourites][exclude] endpoint=${endpoint} venue=${venueLabel} favouriteMatched=${String(
            favouriteMatched,
          )} favouriteMatchType=${favouriteMatchType} filteredOutReason=not_in_favourites`,
        );
      }
      continue;
    }
    if (providerKey === "sportsdb") {
      sportsIncludedByFavouritesCount += 1;
      console.log(
        `[SPORTS][favourites][include] endpoint=${endpoint} venue=${venueLabel} favouriteMatched=true favouriteMatchType=${favouriteMatchType} favouriteMatchValue=${String(
          favouriteMatchValue ?? "n/a",
        )}`,
      );
    } else {
      eventsIncludedByFavouritesCount += 1;
      console.log(
        `[EVENTS][favourites][include] endpoint=${endpoint} venue=${venueLabel} favouriteMatched=true favouriteMatchType=${favouriteMatchType} favouriteMatchValue=${String(
          favouriteMatchValue ?? "n/a",
        )}`,
      );
    }
    items.push({
      ...signal,
      metadata: {
        ...metadata,
        monitoredByFavourites: true,
        favouriteMatched: true,
        favouriteMatchType,
        favouriteMatchValue,
        filteredOutReason: null,
      },
    });
  }

  return {
    items,
    meta: {
      sportsIncludedByFavouritesCount,
      sportsExcludedNotInFavouritesCount,
      eventsIncludedByFavouritesCount,
      eventsExcludedNotInFavouritesCount,
      excluded,
      allowedMatchTypes: Array.from(allowedMatchTypes),
    },
  };
}

function countUnmatchedSportsOrEvents(items) {
  let count = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const providerKey = String(item?.providerKey ?? "");
    if (providerKey !== "sportsdb" && providerKey !== "ticketmaster") {
      continue;
    }
    const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    const favouriteMatched = metadata.favouriteMatched === true;
    if (!favouriteMatched) {
      count += 1;
    }
  }
  return count;
}

function getLifecycleStatus(signal, nowMs) {
  const startMs = Date.parse(signal?.startsAt ?? "");
  const endMsParsed = Date.parse(signal?.endsAt ?? "");
  const effectiveStartMs = Number.isNaN(startMs) ? null : startMs;
  const effectiveEndMs = Number.isNaN(endMsParsed) ? effectiveStartMs : endMsParsed;

  if (effectiveStartMs == null && effectiveEndMs == null) {
    return "upcoming";
  }
  if (effectiveEndMs != null && nowMs >= effectiveEndMs) {
    return "expired";
  }
  if (effectiveStartMs != null && nowMs >= effectiveStartMs) {
    return "active";
  }
  return "upcoming";
}

function lifecycleRank(signal) {
  const status = signal?.metadata?.lifecycleStatus;
  if (status === "active") return 0;
  if (status === "upcoming") return 1;
  return 2;
}

function sortByLifecycleThenTime(items) {
  return [...items].sort((a, b) => {
    const rankDiff = lifecycleRank(a) - lifecycleRank(b);
    if (rankDiff !== 0) return rankDiff;
    return Date.parse(a.startsAt) - Date.parse(b.startsAt);
  });
}

function isWindsorSignal(signal) {
  const venue = String(signal?.metadata?.venueName ?? signal?.location?.name ?? "").toLowerCase();
  const eventName = String(signal?.metadata?.sourceEventName ?? signal?.title ?? "").toLowerCase();
  return venue.includes("windsor park") || eventName.includes("linfield");
}

module.exports = {
  createSignalPlatform,
};
