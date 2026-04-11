const { toNormalizedSignal } = require("../signalModel");
const {
  fetchUpcomingLeagueEvents,
  fetchEventsBySearchTerms,
  fetchEventsByDayAndSports,
  fetchTeamsByLeagueNames,
  DEFAULT_LEAGUES,
  DEFAULT_SUPPORTED_SPORTS,
  DEFAULT_TEAM_LOOKUP_LEAGUES,
} = require("../sportsDb");

const DEFAULT_DURATION_MINUTES = {
  Soccer: 135,
  Rugby: 130,
  "American Football": 200,
  Basketball: 140,
  Baseball: 190,
};

const SIGNAL_WINDOW_RULE = {
  preEventStartMinusMinutes: 90,
  preEventEndPlusMinutes: 15,
  postEventEndPlusMinutes: 90,
};

const VENUE_GEO_OVERRIDES = {
  "windsor park": { lat: 54.5829, lng: -5.9552, city: "Belfast", country: "United Kingdom", postcode: "BT9" },
  "windsor park belfast": { lat: 54.5829, lng: -5.9552, city: "Belfast", country: "United Kingdom", postcode: "BT9" },
  "sse arena": { lat: 54.6031, lng: -5.909, city: "Belfast", country: "United Kingdom", postcode: "BT3" },
  "sse arena belfast": { lat: 54.6031, lng: -5.909, city: "Belfast", country: "United Kingdom", postcode: "BT3" },
  "ravenhill stadium": { lat: 54.5863, lng: -5.8988, city: "Belfast", country: "United Kingdom", postcode: "BT6" },
  "kingspan stadium": { lat: 54.5863, lng: -5.8988, city: "Belfast", country: "United Kingdom", postcode: "BT6" },
};
const DEFAULT_WATCH_TERMS = ["Windsor Park", "Linfield", "Belfast"];
const LEAK_TRACE_VENUES = [
  "lner stadium",
  "home park",
  "cardiff city stadium",
  "university of bradford stadium",
  "pirelli stadium",
  "the eco-power stadium",
  "accu stadium",
  "aesseal new york stadium",
];

function createSportsDbSignalProvider(options = {}) {
  const { adminConfig } = options;

  async function collectSignals(args = {}) {
    const now = args.now ? new Date(args.now) : new Date();
    const config = adminConfig?.get?.() ?? {};
    const providerEnabled = config.providers?.sportsdb?.enabled === true;
    if (!providerEnabled) {
      return {
        generatedAt: now.toISOString(),
        signals: [],
        diagnostics: {
          providerStatus: "disabled",
          sportsFetchedCount: 0,
          sportsNormalizedCount: 0,
          sportsIncludedCount: 0,
          sportsExcludedCount: 0,
          exclusionReasons: ["provider_disabled"],
          leaguesQueried: [],
          sportsQueried: [],
        },
      };
    }

    const sportsConfig = config.sportsdb ?? {};
    const endpointMode = String(args.mode ?? "unknown").trim() || "unknown";
    const selectedDate = typeof args.date === "string" ? args.date.trim() : null;
    const horizonContext = resolveHorizonContext({
      endpointMode,
      selectedDate,
      now,
      horizonDays: Number(sportsConfig.horizonDays ?? 7),
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
      `[FAVOURITES][watchlist] provider=sportsdb venues=${favouritesWatchlist.venueNames.length} places=${favouritesWatchlist.placeLabels.length} postcodes=${favouritesWatchlist.postcodes.length} outward=${favouritesWatchlist.outwardCodes.length} broadCities=${favouritesWatchlist.broadCities.length} allowBroadCity=${String(
        favouritesWatchlist.allowBroadCity,
      )}`,
    );
    if (favouritesWatchlistCount === 0) {
      return {
        generatedAt: now.toISOString(),
        signals: [],
        diagnostics: {
          providerStatus: "no_favourites_watchlist",
          sportsFetchedCount: 0,
          sportsNormalizedCount: 0,
          sportsIncludedCount: 0,
          sportsExcludedCount: 0,
          sportsExcludedNotInFavouritesCount: 0,
          exclusionReasons: [{ reason: "no_favourites_watchlist", count: 1 }],
          leaguesQueried: [],
          sportsQueried: [],
          watchTermsQueried: [],
          favouriteWatchlistSummary: watchlistSummary,
          favouritesWatchlistCount,
        },
      };
    }
    const leagues = Array.isArray(sportsConfig.leagues) && sportsConfig.leagues.length > 0
      ? sportsConfig.leagues
      : DEFAULT_LEAGUES;
    const baseWatchTerms = buildFavouriteDrivenWatchTerms(favouritesWatchlist);
    let selectedDateTeamTerms = [];
    let teamLookupDiagnostics = {
      endpointUsed: "search_all_teams.php",
      leaguesQueried: [],
      fetchedCount: 0,
      failedLeagues: [],
      matchedTeams: [],
    };
    const useBroadLeagueDiscovery = sportsConfig.enableBroadLeagueDiscovery === true;
    const countryFilter = resolveCountryFilter(args, sportsConfig);
    const cityFilter = resolveCityFilter(args, sportsConfig);
    const fetchStarted = Date.now();
    console.log(`[SPORTS][fetch] start leagues=${leagues.length} country=${countryFilter ?? "any"} city=${cityFilter ?? "any"}`);
    console.log(
      `[SPORTS][horizon] endpointMode=${endpointMode} selectedDate=${selectedDate ?? "n/a"} horizonMode=${horizonContext.horizonMode} selectedDateWindowStart=${horizonContext.selectedDateWindowStart ?? "n/a"} selectedDateWindowEnd=${horizonContext.selectedDateWindowEnd ?? "n/a"}`,
    );

    let fetchedEvents = [];
    let searchEvents = [];
    let dayEvents = [];
    let watchTerms = [...baseWatchTerms];
    let fetchDiagnostics = {
      provider: "thesportsdb",
      leaguesQueried: [],
      sportsQueried: [],
      fetchedCount: 0,
      failedLeagues: [],
      endpointUsed: "eventsnextleague.php",
    };
    let providerStatus = "ok";
    try {
      if (useBroadLeagueDiscovery) {
        const fetchResult = await fetchUpcomingLeagueEvents({
          apiKey: sportsConfig.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3",
          leagues,
          timeoutMs: Number.isFinite(Number(sportsConfig.timeoutMs)) ? Number(sportsConfig.timeoutMs) : 5000,
        });
        fetchedEvents = fetchResult.events ?? [];
        fetchDiagnostics = fetchResult.diagnostics ?? fetchDiagnostics;
      } else {
        fetchDiagnostics.endpointUsed = "searchevents.php";
      }
      if (horizonContext.horizonMode === "selected_date" && selectedDate) {
        const dayResult = await fetchEventsByDayAndSports({
          apiKey: sportsConfig.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3",
          date: selectedDate,
          sports:
            Array.isArray(sportsConfig.sportsOfInterest) && sportsConfig.sportsOfInterest.length > 0
              ? sportsConfig.sportsOfInterest
              : DEFAULT_SUPPORTED_SPORTS,
          timeoutMs: Number.isFinite(Number(sportsConfig.timeoutMs)) ? Number(sportsConfig.timeoutMs) : 5000,
        });
        dayEvents = dayResult.events ?? [];
        fetchDiagnostics.dayFetchedCount = dayResult.diagnostics?.fetchedCount ?? dayEvents.length;
        fetchDiagnostics.daySportsQueried = dayResult.diagnostics?.sportsQueried ?? [];
        fetchDiagnostics.dayFailedSports = dayResult.diagnostics?.failedSports ?? [];
      }
      if (horizonContext.horizonMode === "selected_date" && selectedDate) {
        const selectedDateSearchTerms = await buildSelectedDateSearchTermsFromFavourites({
          apiKey: sportsConfig.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3",
          timeoutMs: Number.isFinite(Number(sportsConfig.timeoutMs)) ? Number(sportsConfig.timeoutMs) : 5000,
          sportsConfig,
          favouritesWatchlist,
        });
        selectedDateTeamTerms = selectedDateSearchTerms.terms;
        teamLookupDiagnostics = selectedDateSearchTerms.diagnostics;
      }
      watchTerms = dedupeTerms([...baseWatchTerms, ...selectedDateTeamTerms]);
      const searchResult = await fetchEventsBySearchTerms({
        apiKey: sportsConfig.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3",
        terms: watchTerms,
        timeoutMs: Number.isFinite(Number(sportsConfig.timeoutMs)) ? Number(sportsConfig.timeoutMs) : 5000,
      });
      searchEvents = searchResult.events ?? [];
      fetchDiagnostics.watchTermsQueried = searchResult.diagnostics?.termsQueried ?? [];
      fetchDiagnostics.searchFetchedCount = searchResult.diagnostics?.fetchedCount ?? searchEvents.length;
      fetchDiagnostics.searchFailedTerms = searchResult.diagnostics?.failedTerms ?? [];
      fetchDiagnostics.leaguesQueried = useBroadLeagueDiscovery ? (fetchDiagnostics.leaguesQueried ?? leagues) : [];
      fetchDiagnostics.teamLookup = teamLookupDiagnostics;
    } catch (error) {
      providerStatus = "fetch_failed";
      console.log(`[SPORTS][fetch] fail durationMs=${Date.now() - fetchStarted} error=${error instanceof Error ? error.message : String(error)}`);
      return {
        generatedAt: now.toISOString(),
        signals: [],
        diagnostics: {
          providerStatus,
          sportsFetchedCount: 0,
          sportsNormalizedCount: 0,
          sportsIncludedCount: 0,
          sportsExcludedCount: 0,
          exclusionReasons: ["provider_fetch_failed"],
          leaguesQueried: [],
          sportsQueried: [],
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
    const combinedSourceEvents = dedupeSportsEvents([...fetchedEvents, ...dayEvents, ...searchEvents]);
    console.log(
      `[SPORTS][fetch] success durationMs=${Date.now() - fetchStarted} fetchedLeague=${fetchedEvents.length} fetchedDay=${dayEvents.length} fetchedSearch=${searchEvents.length} deduped=${combinedSourceEvents.length}`,
    );
    if (searchEvents.length > 0) {
      const searchSummary = searchEvents.slice(0, 30).map((event) => {
        const parsed = parseSportsStartTime(event);
        return buildRawEventSummary(event, {
          parsedUtcKickoff:
            parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
          parsedLocalKickoff:
            parsed && !Number.isNaN(parsed.getTime())
              ? parsed.toLocaleString("en-GB", {
                  timeZone: "Europe/London",
                  hour12: false,
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null,
          exclusionReason: null,
        });
      });
      console.log(
        `[SPORTS][fetch][search-events] count=${searchEvents.length} rows=${JSON.stringify(searchSummary)}`,
      );
    }

    const normalizeStarted = Date.now();
    const signals = [];
    const exclusionReasons = {};
    let normalizedCount = 0;
    let includedCount = 0;
    let excludedCount = 0;
    let excludedNotInFavouritesCount = 0;
    const rawFetchedEventsSummary = [];
    let targetFixtureFound = false;
    let targetFixtureDropReason = null;

    for (const event of combinedSourceEvents) {
      const isWindsorCandidate = isWindsorTraceCandidate(event);
      const traceVenue = String(event.strVenue ?? "").trim();
      const isLeakCandidate = isLeakTraceVenue(traceVenue);
      const rawDateEvent = String(event.dateEvent ?? "").trim() || null;
      const rawTime = String(event.strTime ?? "").trim() || null;
      const rawTimeLocal = String(event.strTimeLocal ?? "").trim() || null;
      const rawTimestamp = String(event.strTimestamp ?? "").trim() || null;
      const parsedKickoffForSummary = parseSportsStartTime(event);
      const parsedUtcKickoffForSummary =
        parsedKickoffForSummary && !Number.isNaN(parsedKickoffForSummary.getTime())
          ? parsedKickoffForSummary.toISOString()
          : null;
      const parsedLocalKickoffForSummary =
        parsedKickoffForSummary && !Number.isNaN(parsedKickoffForSummary.getTime())
          ? parsedKickoffForSummary.toLocaleString("en-GB", {
              timeZone: "Europe/London",
              hour12: false,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : null;
      const fixtureKeyBlob = normalizeToken(
        `${event.strEvent ?? ""} ${event.strHomeTeam ?? ""} ${event.strAwayTeam ?? ""} ${event.strVenue ?? ""}`,
      );
      const isTargetFixtureCandidate =
        fixtureKeyBlob.includes("linfield") &&
        fixtureKeyBlob.includes("larne") &&
        fixtureKeyBlob.includes("windsor park");
      const isTargetFixtureOnSelectedDate =
        isTargetFixtureCandidate &&
        Boolean(selectedDate) &&
        rawDateEvent === selectedDate;
      if (isTargetFixtureOnSelectedDate || (!selectedDate && isTargetFixtureCandidate)) {
        targetFixtureFound = true;
      }
      let exclusionReasonForEvent = null;
      if (isWindsorCandidate) {
        const parsedKickoff = parseSportsStartTime(event);
        const parsedUtcKickoff = parsedKickoff && !Number.isNaN(parsedKickoff.getTime()) ? parsedKickoff.toISOString() : "invalid";
        const parsedUkLocalKickoff =
          parsedKickoff && !Number.isNaN(parsedKickoff.getTime())
            ? parsedKickoff.toLocaleString("en-GB", {
                timeZone: "Europe/London",
                hour12: false,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "invalid";
        console.log(
          `[SPORTS][trace][windsor] fetched id=${String(event.idEvent ?? "n/a")} league=${String(
            event.strLeague ?? event.__leagueName ?? "n/a",
          )} raw_dateEvent=${rawDateEvent ?? "n/a"} raw_strTime=${rawTime ?? "n/a"} raw_strTimeLocal=${rawTimeLocal ?? "n/a"} raw_strTimestamp=${rawTimestamp ?? "n/a"} parsedUtcKickoff=${parsedUtcKickoff} parsedUkLocalKickoff=${parsedUkLocalKickoff} venue=${String(
            event.strVenue ?? "n/a",
          )} city=${String(event.strCity ?? "n/a")} country=${String(event.strCountry ?? "n/a")}`,
        );
      }
      if (isLeakCandidate) {
        console.log(
          `[SPORTS][trace][leak] stage=fetched venue=${traceVenue} id=${String(
            event.idEvent ?? "n/a",
          )} league=${String(event.strLeague ?? event.__leagueName ?? "n/a")} start=${String(
            event.strTimestamp ?? `${event.dateEvent ?? ""} ${event.strTime ?? ""}`,
          )}`,
        );
      }
      const startAt = parseSportsStartTime(event);
      if (!startAt) {
        pushReason(exclusionReasons, "missing_start_time");
        exclusionReasonForEvent = "missing_start_time";
        if (isWindsorCandidate) {
          console.log("[SPORTS][filter][windsor] excluded reason=missing_start_time");
        }
        if (isLeakCandidate) {
          console.log(`[SPORTS][trace][leak] stage=excluded venue=${traceVenue} reason=missing_start_time`);
        }
        excludedCount += 1;
        rawFetchedEventsSummary.push(buildRawEventSummary(event, {
          parsedUtcKickoff: parsedUtcKickoffForSummary,
          parsedLocalKickoff: parsedLocalKickoffForSummary,
          exclusionReason: exclusionReasonForEvent,
        }));
        if (isTargetFixtureOnSelectedDate || (!selectedDate && isTargetFixtureCandidate)) {
          targetFixtureDropReason = exclusionReasonForEvent;
        }
        continue;
      }
      const sportType = normalizeSportType(event.strSport ?? event.__leagueSportType ?? null);
      if (!sportType) {
        pushReason(exclusionReasons, "missing_sport_type");
        exclusionReasonForEvent = "missing_sport_type";
        if (isWindsorCandidate) {
          console.log("[SPORTS][filter][windsor] excluded reason=missing_sport_type");
        }
        if (isLeakCandidate) {
          console.log(`[SPORTS][trace][leak] stage=excluded venue=${traceVenue} reason=missing_sport_type`);
        }
        excludedCount += 1;
        rawFetchedEventsSummary.push(buildRawEventSummary(event, {
          parsedUtcKickoff: parsedUtcKickoffForSummary,
          parsedLocalKickoff: parsedLocalKickoffForSummary,
          exclusionReason: exclusionReasonForEvent,
        }));
        if (isTargetFixtureOnSelectedDate || (!selectedDate && isTargetFixtureCandidate)) {
          targetFixtureDropReason = exclusionReasonForEvent;
        }
        continue;
      }
      const estimatedDurationMinutes = getDurationMinutesForSport(sportType);
      const endsAtEstimated = new Date(startAt.getTime() + estimatedDurationMinutes * 60 * 1000);
      const preWindowStart = new Date(startAt.getTime() - SIGNAL_WINDOW_RULE.preEventStartMinusMinutes * 60 * 1000);
      const preWindowEnd = new Date(startAt.getTime() + SIGNAL_WINDOW_RULE.preEventEndPlusMinutes * 60 * 1000);
      const postWindowStart = new Date(endsAtEstimated.getTime());
      const postWindowEnd = new Date(endsAtEstimated.getTime() + SIGNAL_WINDOW_RULE.postEventEndPlusMinutes * 60 * 1000);
      if (
        !isWithinHorizon(
          {
            startAt,
            preWindowStart,
            preWindowEnd,
            postWindowStart,
            postWindowEnd,
          },
          horizonContext,
        )
      ) {
        pushReason(exclusionReasons, "outside_horizon");
        exclusionReasonForEvent = "outside_horizon";
        if (isWindsorCandidate) {
          console.log(
            `[SPORTS][filter][windsor] excluded reason=outside_horizon endpointMode=${endpointMode} selectedDate=${selectedDate ?? "n/a"} horizonMode=${horizonContext.horizonMode} sourceStartTime=${startAt.toISOString()} selectedDateWindowStart=${horizonContext.selectedDateWindowStart ?? "n/a"} selectedDateWindowEnd=${horizonContext.selectedDateWindowEnd ?? "n/a"} now=${now.toISOString()}`,
          );
        }
        if (isLeakCandidate) {
          console.log(
            `[SPORTS][trace][leak] stage=excluded venue=${traceVenue} reason=outside_horizon endpointMode=${endpointMode} selectedDate=${selectedDate ?? "n/a"} horizonMode=${horizonContext.horizonMode} sourceStartTime=${startAt.toISOString()} selectedDateWindowStart=${horizonContext.selectedDateWindowStart ?? "n/a"} selectedDateWindowEnd=${horizonContext.selectedDateWindowEnd ?? "n/a"}`,
          );
        }
        excludedCount += 1;
        rawFetchedEventsSummary.push(buildRawEventSummary(event, {
          parsedUtcKickoff: parsedUtcKickoffForSummary,
          parsedLocalKickoff: parsedLocalKickoffForSummary,
          exclusionReason: exclusionReasonForEvent,
        }));
        if (isTargetFixtureOnSelectedDate || (!selectedDate && isTargetFixtureCandidate)) {
          targetFixtureDropReason = exclusionReasonForEvent;
        }
        continue;
      }
      const country = String(event.strCountry ?? event.__leagueCountry ?? "").trim() || null;
      const city = String(event.strCity ?? "").trim() || null;
      if (countryFilter && country && !countryMatchesFilter(country, countryFilter)) {
        pushReason(exclusionReasons, "country_filtered");
        exclusionReasonForEvent = "country_filtered";
        if (isWindsorCandidate) {
          console.log(
            `[SPORTS][filter][windsor] excluded reason=country_filtered country=${country} filter=${countryFilter}`,
          );
        }
        if (isLeakCandidate) {
          console.log(`[SPORTS][trace][leak] stage=excluded venue=${traceVenue} reason=country_filtered`);
        }
        excludedCount += 1;
        rawFetchedEventsSummary.push(buildRawEventSummary(event, {
          parsedUtcKickoff: parsedUtcKickoffForSummary,
          parsedLocalKickoff: parsedLocalKickoffForSummary,
          exclusionReason: exclusionReasonForEvent,
        }));
        if (isTargetFixtureOnSelectedDate || (!selectedDate && isTargetFixtureCandidate)) {
          targetFixtureDropReason = exclusionReasonForEvent;
        }
        continue;
      }
      if (cityFilter && city && city.toLowerCase() !== cityFilter.toLowerCase()) {
        pushReason(exclusionReasons, "city_filtered");
        exclusionReasonForEvent = "city_filtered";
        if (isWindsorCandidate) {
          console.log(
            `[SPORTS][filter][windsor] excluded reason=city_filtered city=${city} filter=${cityFilter}`,
          );
        }
        if (isLeakCandidate) {
          console.log(`[SPORTS][trace][leak] stage=excluded venue=${traceVenue} reason=city_filtered`);
        }
        excludedCount += 1;
        rawFetchedEventsSummary.push(buildRawEventSummary(event, {
          parsedUtcKickoff: parsedUtcKickoffForSummary,
          parsedLocalKickoff: parsedLocalKickoffForSummary,
          exclusionReason: exclusionReasonForEvent,
        }));
        if (isTargetFixtureOnSelectedDate || (!selectedDate && isTargetFixtureCandidate)) {
          targetFixtureDropReason = exclusionReasonForEvent;
        }
        continue;
      }

      const geo = resolveGeo(event);
      const favouriteMatch = resolveFavouriteMatch(
        event,
        geo,
        favouritesWatchlist,
        Number.isFinite(Number(args.radiusMiles)) ? Number(args.radiusMiles) : null,
      );
      const outward = deriveOutwardCode(String(geo.postcode ?? event.strPostcode ?? "").trim().toUpperCase());
      const decisionTrace = {
        venueName: traceVenue || "n/a",
        favVenue: favouritesWatchlist.rawVenueNames[0] ?? null,
        venueNormalized: normalizeToken(traceVenue),
        favNormalized: normalizeToken(favouritesWatchlist.rawVenueNames[0] ?? ""),
        postcode: String(geo.postcode ?? event.strPostcode ?? "").trim().toUpperCase() || null,
        outward: outward || null,
        distanceMiles: Number.isFinite(Number(favouriteMatch.distanceMiles))
          ? Number(favouriteMatch.distanceMiles)
          : null,
      };
      if (!favouriteMatch.matched) {
        pushReason(exclusionReasons, "not_in_favourites");
        excludedNotInFavouritesCount += 1;
        exclusionReasonForEvent = "not_in_favourites";
        const traceVenue = String(event.strVenue ?? "").trim();
        console.log(
          `[SPORTS][favourites][exclude] venueName=${decisionTrace.venueName} favVenue=${String(
            decisionTrace.favVenue ?? "n/a",
          )} venueNormalized=${decisionTrace.venueNormalized} favNormalized=${decisionTrace.favNormalized} postcode=${String(
            decisionTrace.postcode ?? "n/a",
          )} outward=${String(decisionTrace.outward ?? "n/a")} distanceMiles=${String(
            decisionTrace.distanceMiles ?? "n/a",
          )} favouriteMatched=false favouriteMatchType=none filteredOutReason=not_in_favourites`,
        );
        if (isLeakTraceVenue(traceVenue)) {
          console.log(
            `[SPORTS][trace][leak] venue=${traceVenue} favouriteMatched=false favouriteMatchType=none finalDecision=excluded`,
          );
        }
        excludedCount += 1;
        rawFetchedEventsSummary.push(buildRawEventSummary(event, {
          parsedUtcKickoff: parsedUtcKickoffForSummary,
          parsedLocalKickoff: parsedLocalKickoffForSummary,
          exclusionReason: exclusionReasonForEvent,
        }));
        if (isTargetFixtureOnSelectedDate || (!selectedDate && isTargetFixtureCandidate)) {
          targetFixtureDropReason = exclusionReasonForEvent;
        }
        continue;
      }
      console.log(
        `[SPORTS][favourites][include] venueName=${decisionTrace.venueName} favVenue=${String(
          decisionTrace.favVenue ?? "n/a",
        )} venueNormalized=${decisionTrace.venueNormalized} favNormalized=${decisionTrace.favNormalized} postcode=${String(
          decisionTrace.postcode ?? "n/a",
        )} outward=${String(decisionTrace.outward ?? "n/a")} distanceMiles=${String(
          decisionTrace.distanceMiles ?? "n/a",
        )} favouriteMatched=true favouriteMatchType=${favouriteMatch.matchType} favouriteMatchValue=${String(
          favouriteMatch.matchValue ?? "n/a",
        )}`,
      );
      if (isLeakTraceVenue(traceVenue)) {
        console.log(
          `[SPORTS][trace][leak] venue=${traceVenue} favouriteMatched=true favouriteMatchType=${favouriteMatch.matchType} finalDecision=included`,
        );
      }
      const baseTitle = String(event.strEvent || [event.strHomeTeam, event.strAwayTeam].filter(Boolean).join(" vs ") || "Sports fixture");
      const venueName = String(event.strVenue ?? "").trim() || "Venue TBC";
      const leagueName = String(event.strLeague ?? event.__leagueName ?? "").trim() || "League";
      const sourceEventId = String(event.idEvent ?? "");
      const sourceStartTime = startAt.toISOString();
      const localTimeLabel = formatLocalTimeWindow(startAt, endsAtEstimated);
      const metadata = {
        provider: "thesportsdb",
        category: "sports",
        isBaseline: true,
        isLiveException: false,
        sourceEventId: sourceEventId || null,
        sourceEventName: baseTitle,
        sourceLeague: leagueName,
        sourceSport: sportType,
        sourceStartTime,
        estimatedEndTime: endsAtEstimated.toISOString(),
        venueName,
        venueCity: city,
        venueCountry: country,
        lat: geo.lat,
        lng: geo.lng,
        postcode: geo.postcode,
        geoConfidence: geo.geoConfidence,
        geoResolutionStatus: geo.geoResolutionStatus,
        configuredRadiusMiles: null,
        distanceMiles:
          Number.isFinite(Number(favouriteMatch.distanceMiles))
            ? Number(favouriteMatch.distanceMiles)
            : null,
        withinRadius: geo.geoConfidence === "exact",
        eligibilityReason: geo.geoConfidence === "exact" ? "geo_exact_ready_for_radius_eval" : "geo_not_exact",
        filteredOutReason: null,
        promotionEligible: geo.geoConfidence === "exact",
        includedInDiary: true,
        includedInProximity: false,
        favouriteMatched: true,
        monitoredByFavourites: true,
        favouriteMatchType: favouriteMatch.matchType,
        favouriteMatchValue: favouriteMatch.matchValue,
        favouriteMatchReason: favouriteMatch.matchReason ?? (isWindsorCandidate ? "watch_term_match" : null),
        estimatedDurationMinutes,
        endTimeInferenceRule: `default_duration_${sportType.replace(/\s+/g, "_").toLowerCase()}`,
        signalWindowRule: SIGNAL_WINDOW_RULE,
        homeTeam: event.strHomeTeam ?? null,
        awayTeam: event.strAwayTeam ?? null,
        expectedIntensity: "elevated",
        rawVenueFieldsUsed: {
          strVenue: event.strVenue ?? null,
          strCity: event.strCity ?? null,
          strCountry: event.strCountry ?? null,
          strLatitude: event.strLatitude ?? null,
          strLongitude: event.strLongitude ?? null,
        },
        providerDiagnostics: {
          endpoint: fetchDiagnostics.endpointUsed,
          leagueId: event.__leagueId ?? null,
          searchTerm: event.__searchTerm ?? null,
          eventTimestampField: event.strTimestamp ?? null,
          eventDateField: event.dateEvent ?? null,
          eventTimeField: event.strTime ?? null,
          eventTimeLocalField: event.strTimeLocal ?? null,
          apiKeyMode: fetchDiagnostics.apiKeyMode ?? null,
          endpointMode,
          selectedDate,
          horizonMode: horizonContext.horizonMode,
          sourceStartTime,
          selectedDateWindowStart: horizonContext.selectedDateWindowStart,
          selectedDateWindowEnd: horizonContext.selectedDateWindowEnd,
        },
      };
      if (isWindsorCandidate) {
        console.log(
          `[SPORTS][normalize][windsor] id=${sourceEventId || "n/a"} start=${sourceStartTime} preStart=${preWindowStart.toISOString()} postStart=${postWindowStart.toISOString()} geo=${geo.geoConfidence} promoEligible=${metadata.promotionEligible}`,
        );
      }
      if (isLeakCandidate) {
        console.log(
          `[SPORTS][trace][leak] stage=normalized venue=${traceVenue} favouriteMatched=true favouriteMatchType=${favouriteMatch.matchType}`,
        );
      }

      const preSignal = toNormalizedSignal({
        id: `sportsdb:${sourceEventId || slugify(baseTitle)}:pre_event_arrivals:${preWindowStart.toISOString()}`,
        provider: "thesportsdb",
        providerKey: "sportsdb",
        category: "sports",
        sportType,
        competition: leagueName,
        title: `${venueName} arrivals building`,
        subtitle: `${baseTitle} pre-event arrivals expected`,
        description: `${baseTitle} at ${venueName}. Pre-event arrivals likely.`,
        severity: "warning",
        startsAt: preWindowStart.toISOString(),
        endsAt: preWindowEnd.toISOString(),
        localTimeLabel,
        signalType: "sports_pre_event_arrivals",
        expectedIntensity: "elevated",
        regionKey: String(args.regionKey ?? "uk-ni"),
        location: {
          locationId: `sports:${slugify(venueName)}`,
          name: venueName,
          postcode: geo.postcode,
          lat: geo.lat,
          lng: geo.lng,
          city: city ?? geo.city,
        },
        metadata: {
          ...metadata,
          expectedIntensity: "elevated",
          signalPhase: "pre_event_arrivals",
          startsAt: preWindowStart.toISOString(),
          endsAtEstimated: preWindowEnd.toISOString(),
        },
      });
      const postSignal = toNormalizedSignal({
        id: `sportsdb:${sourceEventId || slugify(baseTitle)}:post_event_dispersal:${postWindowStart.toISOString()}`,
        provider: "thesportsdb",
        providerKey: "sportsdb",
        category: "sports",
        sportType,
        competition: leagueName,
        title: `${venueName} event finishing soon`,
        subtitle: "Post-match dispersal expected",
        description: `${baseTitle} expected to finish around ${formatClock(endsAtEstimated)} with outbound pickup demand likely.`,
        severity: "warning",
        startsAt: postWindowStart.toISOString(),
        endsAt: postWindowEnd.toISOString(),
        localTimeLabel,
        signalType: "sports_post_event_dispersal",
        expectedIntensity: "high",
        regionKey: String(args.regionKey ?? "uk-ni"),
        location: {
          locationId: `sports:${slugify(venueName)}`,
          name: venueName,
          postcode: geo.postcode,
          lat: geo.lat,
          lng: geo.lng,
          city: city ?? geo.city,
        },
        metadata: {
          ...metadata,
          expectedIntensity: "high",
          signalPhase: "post_event_dispersal",
          startsAt: postWindowStart.toISOString(),
          endsAtEstimated: postWindowEnd.toISOString(),
        },
      });
      signals.push(preSignal, postSignal);
      normalizedCount += 2;
      includedCount += 2;
      rawFetchedEventsSummary.push(buildRawEventSummary(event, {
        parsedUtcKickoff: parsedUtcKickoffForSummary,
        parsedLocalKickoff: parsedLocalKickoffForSummary,
        exclusionReason: null,
      }));
      if (isTargetFixtureOnSelectedDate || (!selectedDate && isTargetFixtureCandidate)) {
        targetFixtureDropReason = null;
      }
    }

    console.log(
      `[SPORTS][normalize] durationMs=${Date.now() - normalizeStarted} normalized=${normalizedCount} included=${includedCount} excluded=${excludedCount}`,
    );
    console.log(
      `[SPORTS][signals] fetched=${(fetchDiagnostics.fetchedCount ?? fetchedEvents.length) + (fetchDiagnostics.dayFetchedCount ?? dayEvents.length) + (fetchDiagnostics.searchFetchedCount ?? searchEvents.length)} included=${includedCount} excluded=${excludedCount} reasons=${Object.keys(exclusionReasons).join(",") || "none"}`,
    );
    if (!targetFixtureFound && targetFixtureDropReason == null) {
      targetFixtureDropReason = "not_fetched";
    }
    console.log(
      `[SPORTS][target-fixture] selectedDate=${selectedDate ?? "n/a"} targetFixtureFound=${String(
        targetFixtureFound,
      )} targetFixtureDropReason=${String(targetFixtureDropReason ?? "none")}`,
    );

    return {
      generatedAt: now.toISOString(),
      signals,
      diagnostics: {
        providerStatus,
        sportsFetchedCount:
          (fetchDiagnostics.fetchedCount ?? fetchedEvents.length) +
          (fetchDiagnostics.dayFetchedCount ?? dayEvents.length) +
          (fetchDiagnostics.searchFetchedCount ?? searchEvents.length),
        sportsNormalizedCount: normalizedCount,
        sportsIncludedCount: includedCount,
        sportsExcludedCount: excludedCount,
        sportsExcludedNotInFavouritesCount: excludedNotInFavouritesCount,
        exclusionReasons: Object.entries(exclusionReasons).map(([reason, count]) => ({ reason, count })),
        fetchedLeagueIds: (fetchDiagnostics.leaguesQueried ?? []).map((value) => String(value)),
        fetchedSearchTerms: (fetchDiagnostics.watchTermsQueried ?? watchTerms).map((value) => String(value)),
        fetchedTeamLookupLeagues: (fetchDiagnostics.teamLookup?.leaguesQueried ?? []).map((value) => String(value)),
        fetchedTeamLookupCount: Number(fetchDiagnostics.teamLookup?.fetchedCount ?? 0),
        fetchedTeamLookupMatchedTeams: Array.isArray(fetchDiagnostics.teamLookup?.matchedTeams)
          ? fetchDiagnostics.teamLookup.matchedTeams.slice(0, 50)
          : [],
        fetchedTeamLookupFailedLeagues: Array.isArray(fetchDiagnostics.teamLookup?.failedLeagues)
          ? fetchDiagnostics.teamLookup.failedLeagues
          : [],
        rawFetchedEventsSummary,
        targetFixtureFound,
        targetFixtureDropReason,
        leaguesQueried: fetchDiagnostics.leaguesQueried ?? [],
        sportsQueried: fetchDiagnostics.sportsQueried ?? [],
        watchTermsQueried: fetchDiagnostics.watchTermsQueried ?? watchTerms,
        failedLeagues: fetchDiagnostics.failedLeagues ?? [],
        failedSearchTerms: fetchDiagnostics.searchFailedTerms ?? [],
        favouriteWatchlistSummary: watchlistSummary,
        favouritesWatchlistCount,
        endpointMode,
        selectedDate,
        horizonMode: horizonContext.horizonMode,
        selectedDateWindowStart: horizonContext.selectedDateWindowStart,
        selectedDateWindowEnd: horizonContext.selectedDateWindowEnd,
      },
    };
  }

  return {
    collectSignals,
  };
}

function resolveCountryFilter(args, sportsConfig) {
  const fromArgs = String(args.country ?? "").trim();
  if (fromArgs) return fromArgs;
  const fromConfig = String(sportsConfig.country ?? "").trim();
  if (fromConfig) return fromConfig;
  return null;
}

function countryMatchesFilter(eventCountry, filter) {
  const eventValue = String(eventCountry ?? "").trim().toLowerCase();
  const filterValue = String(filter ?? "").trim().toLowerCase();
  if (!eventValue || !filterValue) return true;
  if (eventValue === filterValue) return true;
  if (filterValue === "gb" || filterValue === "uk" || filterValue === "united kingdom") {
    return (
      eventValue === "united kingdom" ||
      eventValue === "england" ||
      eventValue === "scotland" ||
      eventValue === "wales" ||
      eventValue === "northern ireland"
    );
  }
  if (filterValue.length === 2) {
    return true;
  }
  return eventValue.includes(filterValue) || filterValue.includes(eventValue);
}

function dedupeSportsEvents(events) {
  const map = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const key = String(event?.idEvent ?? "").trim() || buildEventKey(event);
    if (!map.has(key)) {
      map.set(key, event);
      continue;
    }
    const existing = map.get(key);
    const existingLeague = String(existing?.__leagueId ?? "").trim();
    const incomingLeague = String(event?.__leagueId ?? "").trim();
    if (!existingLeague && incomingLeague) {
      map.set(key, event);
    }
  }
  return Array.from(map.values());
}

function buildEventKey(event) {
  return [
    String(event?.strEvent ?? "").trim().toLowerCase(),
    String(event?.strTimestamp ?? `${event?.dateEvent ?? ""}T${event?.strTime ?? ""}`).trim().toLowerCase(),
    String(event?.strVenue ?? "").trim().toLowerCase(),
  ].join("|");
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

function isWindsorTraceCandidate(event) {
  const blob = JSON.stringify({
    idEvent: event?.idEvent,
    strEvent: event?.strEvent,
    strVenue: event?.strVenue,
    strCity: event?.strCity,
    strLeague: event?.strLeague,
    strHomeTeam: event?.strHomeTeam,
    strAwayTeam: event?.strAwayTeam,
  }).toLowerCase();
  return (
    blob.includes("windsor park") ||
    blob.includes("linfield")
  );
}

function isLeakTraceVenue(value) {
  const normalized = normalizeToken(value);
  return LEAK_TRACE_VENUES.includes(normalized);
}

function resolveCityFilter(args, sportsConfig) {
  const fromArgs = String(args.city ?? "").trim();
  if (fromArgs && args.cityExplicit === true) return fromArgs;
  const fromConfig = String(sportsConfig.city ?? "").trim();
  if (fromConfig) return fromConfig;
  return null;
}

function parseSportsStartTime(event) {
  const timestamp = String(event.strTimestamp ?? "").trim();
  if (timestamp) {
    const parsed = parseTimestampAsUtcWhenZoneMissing(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  const date = String(event.dateEvent ?? "").trim();
  if (!date) return null;
  const time = String(event.strTime ?? "").trim() || "12:00:00";
  const normalizedTime = /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? (time.length === 5 ? `${time}:00` : time) : "12:00:00";
  const parsed = new Date(`${date}T${normalizedTime}Z`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return null;
}

function parseTimestampAsUtcWhenZoneMissing(rawTimestamp) {
  const trimmed = String(rawTimestamp ?? "").trim();
  if (!trimmed) return new Date(Number.NaN);
  const hasExplicitZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed);
  if (hasExplicitZone) {
    return new Date(trimmed);
  }
  return new Date(`${trimmed}Z`);
}

function getDurationMinutesForSport(sportType) {
  if (DEFAULT_DURATION_MINUTES[sportType]) {
    return DEFAULT_DURATION_MINUTES[sportType];
  }
  return 140;
}

function normalizeSportType(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "football") return "Soccer";
  if (raw.toLowerCase() === "soccer") return "Soccer";
  if (raw.toLowerCase().includes("rugby")) return "Rugby";
  if (raw.toLowerCase() === "american football") return "American Football";
  if (raw.toLowerCase() === "basketball") return "Basketball";
  if (raw.toLowerCase() === "baseball") return "Baseball";
  return raw;
}

function resolveGeo(event) {
  const lat = toFiniteNumber(event.strLatitude ?? event.floatLat ?? null);
  const lng = toFiniteNumber(event.strLongitude ?? event.floatLong ?? null);
  const looksLikeZeroPair =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) < 0.00001 &&
    Math.abs(lng) < 0.00001;
  if (Number.isFinite(lat) && Number.isFinite(lng) && !looksLikeZeroPair) {
    return {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      city: String(event.strCity ?? "").trim() || null,
      country: String(event.strCountry ?? "").trim() || null,
      postcode: normalizePostcode(String(event.strPostcode ?? "")),
      geoConfidence: "exact",
      geoResolutionStatus: "provider_coordinates",
    };
  }
  const venueKey = String(event.strVenue ?? "").trim().toLowerCase();
  const override = VENUE_GEO_OVERRIDES[venueKey];
  if (override) {
    return {
      lat: override.lat,
      lng: override.lng,
      city: override.city,
      country: override.country,
      postcode: override.postcode,
      geoConfidence: "exact",
      geoResolutionStatus: "known_venue_override",
    };
  }
  const city = String(event.strCity ?? "").trim();
  if (city) {
    return {
      lat: null,
      lng: null,
      city,
      country: String(event.strCountry ?? "").trim() || null,
      postcode: normalizePostcode(String(event.strPostcode ?? "")),
      geoConfidence: "city_level",
      geoResolutionStatus: "city_only",
    };
  }
  return {
    lat: null,
    lng: null,
    city: null,
    country: String(event.strCountry ?? "").trim() || null,
    postcode: null,
    geoConfidence: "missing",
    geoResolutionStatus: "missing_geo",
  };
}

function toFiniteNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pushReason(map, reason) {
  map[reason] = (map[reason] ?? 0) + 1;
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
    rawPlaceLabels: normalizeRawList(source.placeLabels),
    venueNames: normalizeLowerList(source.venueNames),
    placeLabels: normalizeLowerList(source.placeLabels),
    postcodes: normalizeUpperList(source.postcodes),
    outwardCodes: normalizeUpperList(source.outwardCodes),
    points: normalizePoints(source.points),
    broadCities: normalizeLowerList(source.broadCities),
    allowBroadCity: source.allowBroadCity === true,
  };
}

function buildFavouriteDrivenWatchTerms(watchlist) {
  const terms = new Set();
  for (const value of watchlist.rawVenueNames) terms.add(value);
  for (const value of watchlist.rawPlaceLabels) terms.add(value);
  for (const value of watchlist.outwardCodes) terms.add(value);
  if (terms.size === 0) {
    for (const fallback of DEFAULT_WATCH_TERMS) {
      terms.add(String(fallback).toLowerCase());
    }
  }
  return Array.from(terms)
    .map((value) => value.trim())
    .filter(Boolean);
}

function dedupeTerms(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

async function buildSelectedDateSearchTermsFromFavourites(args = {}) {
  const {
    apiKey,
    timeoutMs,
    sportsConfig,
    favouritesWatchlist,
  } = args;
  const rawVenueTerms = dedupeTerms([
    ...(Array.isArray(favouritesWatchlist?.rawVenueNames) ? favouritesWatchlist.rawVenueNames : []),
    ...(Array.isArray(favouritesWatchlist?.rawPlaceLabels) ? favouritesWatchlist.rawPlaceLabels : []),
  ]);
  if (rawVenueTerms.length === 0) {
    return {
      terms: [],
      diagnostics: {
        endpointUsed: "search_all_teams.php",
        leaguesQueried: [],
        fetchedCount: 0,
        failedLeagues: [],
        matchedTeams: [],
      },
    };
  }
  const configuredLeagues = Array.isArray(sportsConfig?.teamLookupLeagues)
    ? sportsConfig.teamLookupLeagues.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const leaguesToQuery = dedupeTerms([...configuredLeagues, ...DEFAULT_TEAM_LOOKUP_LEAGUES]);
  if (leaguesToQuery.length === 0) {
    return {
      terms: [],
      diagnostics: {
        endpointUsed: "search_all_teams.php",
        leaguesQueried: [],
        fetchedCount: 0,
        failedLeagues: [],
        matchedTeams: [],
      },
    };
  }
  const lookup = await fetchTeamsByLeagueNames({
    apiKey,
    timeoutMs,
    leagues: leaguesToQuery,
  });
  const teams = Array.isArray(lookup?.teams) ? lookup.teams : [];
  const favouriteTokens = rawVenueTerms.map((term) => normalizeToken(term)).filter(Boolean);
  const matchedTeams = [];
  for (const team of teams) {
    const teamName = String(team?.strTeam ?? "").trim();
    const stadiumName = String(team?.strStadium ?? "").trim();
    if (!teamName) continue;
    const teamBlob = normalizeToken(`${teamName} ${stadiumName}`);
    const matched = favouriteTokens.find((token) => teamBlob.includes(token) || token.includes(teamBlob));
    if (!matched) continue;
    matchedTeams.push({
      teamName,
      stadiumName: stadiumName || null,
      leagueName: String(team?.strLeague ?? team?.__leagueName ?? "").trim() || null,
      favouriteTokenMatched: matched,
    });
  }
  const derivedTerms = dedupeTerms(matchedTeams.map((item) => item.teamName)).slice(0, 20);
  if (derivedTerms.length > 0) {
    console.log(
      `[SPORTS][fetch] selected-date-team-lookup leagues=${leaguesToQuery.length} matchedTeams=${derivedTerms.length} terms=${JSON.stringify(derivedTerms)}`,
    );
  }
  return {
    terms: derivedTerms,
    diagnostics: {
      endpointUsed: "search_all_teams.php",
      leaguesQueried: leaguesToQuery,
      fetchedCount: Number(lookup?.diagnostics?.fetchedCount ?? teams.length),
      failedLeagues: Array.isArray(lookup?.diagnostics?.failedLeagues)
        ? lookup.diagnostics.failedLeagues
        : [],
      matchedTeams,
    },
  };
}

function resolveFavouriteMatch(event, geo, watchlist, radiusMiles) {
  const venueName = String(event.strVenue ?? "").trim();
  const venueNormalized = normalizeToken(venueName);
  const exactVenueHit = watchlist.rawVenueNames.find(
    (value) => normalizeToken(value) === normalizeToken(venueName),
  );
  if (exactVenueHit) {
    return { matched: true, matchType: "venue_name_exact", matchValue: exactVenueHit, matchReason: "venue_name_exact" };
  }
  if (venueNormalized && watchlist.venueNames.includes(venueNormalized)) {
    return {
      matched: true,
      matchType: "venue_name_normalized",
      matchValue: venueName,
      matchReason: "venue_name_normalized",
    };
  }
  const containsHit = watchlist.rawVenueNames.find((value) => {
    const favoriteNormalized = normalizeToken(value);
    return venueNormalized.includes(favoriteNormalized) || favoriteNormalized.includes(venueNormalized);
  });
  if (containsHit) {
    return {
      matched: true,
      matchType: "venue_name_normalized",
      matchValue: containsHit,
      matchReason: "venue_name_contains",
    };
  }
  if (venueNormalized && watchlist.placeLabels.includes(venueNormalized)) {
    return { matched: true, matchType: "place_alias", matchValue: venueName, matchReason: "venue_alias_match" };
  }
  const postcode = String(geo.postcode ?? event.strPostcode ?? "").trim().toUpperCase();
  if (postcode && watchlist.postcodes.includes(postcode)) {
    return { matched: true, matchType: "postcode_exact", matchValue: postcode, matchReason: "postcode_match" };
  }
  const outward = deriveOutwardCode(postcode);
  if (outward && watchlist.outwardCodes.includes(outward)) {
    return { matched: true, matchType: "outward_code", matchValue: outward, matchReason: "outward_match" };
  }
  if (
    Number.isFinite(Number(radiusMiles)) &&
    Number(radiusMiles) > 0 &&
    Number.isFinite(Number(geo.lat)) &&
    Number.isFinite(Number(geo.lng)) &&
    Array.isArray(watchlist.points) &&
    watchlist.points.length > 0
  ) {
    let closest = null;
    for (const point of watchlist.points) {
      const distanceMiles = haversineMiles(Number(geo.lat), Number(geo.lng), point.lat, point.lng);
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
        matchReason: "postcode_proximity",
        distanceMiles: Number(closest.distanceMiles.toFixed(3)),
      };
    }
  }
  const labelBlob = normalizeToken(
    `${String(event.strEvent ?? "")} ${String(event.strHomeTeam ?? "")} ${String(event.strAwayTeam ?? "")} ${venueName}`,
  );
  const placeLabelHit = watchlist.placeLabels.find((label) => labelBlob.includes(label));
  if (placeLabelHit) {
    return { matched: true, matchType: "place_alias", matchValue: placeLabelHit, matchReason: "place_label_match" };
  }
  return { matched: false, matchType: "none", matchValue: null, matchReason: "not_in_favourites" };
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

function normalizePostcode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  return raw || null;
}

function buildRawEventSummary(event, args = {}) {
  return {
    idEvent: String(event?.idEvent ?? "").trim() || null,
    strEvent: String(event?.strEvent ?? "").trim() || null,
    strLeague: String(event?.strLeague ?? event?.__leagueName ?? "").trim() || null,
    strVenue: String(event?.strVenue ?? "").trim() || null,
    dateEvent: String(event?.dateEvent ?? "").trim() || null,
    strTime: String(event?.strTime ?? "").trim() || null,
    strTimestamp: String(event?.strTimestamp ?? "").trim() || null,
    strTimeLocal: String(event?.strTimeLocal ?? "").trim() || null,
    parsedUtcKickoff: args.parsedUtcKickoff ?? null,
    parsedLocalKickoff: args.parsedLocalKickoff ?? null,
    exclusionReason: args.exclusionReason ?? null,
  };
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
  DEFAULT_DURATION_MINUTES,
  SIGNAL_WINDOW_RULE,
  createSportsDbSignalProvider,
};
