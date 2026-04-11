const SPORTSDB_BASE_URL = "https://www.thesportsdb.com/api/v1/json";

const DEFAULT_SUPPORTED_SPORTS = [
  "Soccer",
  "Rugby",
  "American Football",
  "Basketball",
  "Baseball",
];

const DEFAULT_TEAM_LOOKUP_LEAGUES = [
  "Northern Irish Premiership",
];

const DEFAULT_LEAGUES = [
  { id: "4328", sportType: "Soccer", leagueName: "English Premier League", country: "England" },
  { id: "4330", sportType: "Soccer", leagueName: "Scottish Premier League", country: "Scotland" },
  { id: "4391", sportType: "American Football", leagueName: "NFL", country: "United States" },
  { id: "4387", sportType: "Basketball", leagueName: "NBA", country: "United States" },
  { id: "4424", sportType: "Baseball", leagueName: "MLB", country: "United States" },
  { id: "4514", sportType: "Rugby", leagueName: "United Rugby Championship", country: "Ireland" },
];

async function fetchUpcomingLeagueEvents(args = {}) {
  const apiKey = String(args.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3").trim() || "3";
  const leagues = Array.isArray(args.leagues) && args.leagues.length > 0 ? args.leagues : DEFAULT_LEAGUES;
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 5000;
  const endpointBase = `${SPORTSDB_BASE_URL}/${encodeURIComponent(apiKey)}`;

  const results = [];
  const diagnostics = {
    provider: "thesportsdb",
    apiKeyMode: apiKey === "3" ? "public_test_key" : "configured_key",
    leaguesQueried: [],
    sportsQueried: [],
    fetchedCount: 0,
    failedLeagues: [],
    endpointUsed: "eventsnextleague.php",
  };

  for (const league of leagues) {
    if (!league || !league.id) continue;
    const leagueId = String(league.id);
    diagnostics.leaguesQueried.push(leagueId);
    if (league.sportType) {
      diagnostics.sportsQueried.push(String(league.sportType));
    }
    const url = `${endpointBase}/eventsnextleague.php?id=${encodeURIComponent(leagueId)}`;
    try {
      const payload = await fetchJsonWithTimeout(url, timeoutMs);
      const rows = Array.isArray(payload?.events) ? payload.events : [];
      for (const row of rows) {
        results.push({
          ...row,
          __leagueId: leagueId,
          __leagueSportType: league.sportType ?? null,
          __leagueName: league.leagueName ?? null,
          __leagueCountry: league.country ?? null,
        });
      }
    } catch (error) {
      diagnostics.failedLeagues.push({
        leagueId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  diagnostics.fetchedCount = results.length;
  diagnostics.sportsQueried = Array.from(new Set(diagnostics.sportsQueried)).filter(Boolean);
  return {
    events: results,
    diagnostics,
    defaults: {
      supportedSports: DEFAULT_SUPPORTED_SPORTS,
      leagues: DEFAULT_LEAGUES,
    },
  };
}

async function fetchEventsBySearchTerms(args = {}) {
  const apiKey = String(args.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3").trim() || "3";
  const terms = Array.isArray(args.terms)
    ? args.terms.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 5000;
  const endpointBase = `${SPORTSDB_BASE_URL}/${encodeURIComponent(apiKey)}`;
  const events = [];
  const diagnostics = {
    provider: "thesportsdb",
    endpointUsed: "searchevents.php",
    termsQueried: terms,
    fetchedCount: 0,
    failedTerms: [],
    apiKeyMode: apiKey === "3" ? "public_test_key" : "configured_key",
  };
  for (const term of terms) {
    const url = `${endpointBase}/searchevents.php?e=${encodeURIComponent(term)}`;
    try {
      const payload = await fetchJsonWithTimeout(url, timeoutMs);
      const rows = Array.isArray(payload?.event) ? payload.event : [];
      for (const row of rows) {
        events.push({
          ...row,
          __searchTerm: term,
        });
      }
    } catch (error) {
      diagnostics.failedTerms.push({
        term,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  diagnostics.fetchedCount = events.length;
  return {
    events,
    diagnostics,
  };
}

async function fetchEventsByDayAndSports(args = {}) {
  const apiKey = String(args.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3").trim() || "3";
  const date = String(args.date ?? "").trim();
  const sports = Array.isArray(args.sports)
    ? args.sports.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 5000;
  const endpointBase = `${SPORTSDB_BASE_URL}/${encodeURIComponent(apiKey)}`;
  const events = [];
  const diagnostics = {
    provider: "thesportsdb",
    endpointUsed: "eventsday.php",
    date,
    sportsQueried: sports,
    fetchedCount: 0,
    failedSports: [],
    apiKeyMode: apiKey === "3" ? "public_test_key" : "configured_key",
  };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    diagnostics.failedSports.push({
      sport: "all",
      error: "invalid_date",
    });
    return {
      events: [],
      diagnostics,
    };
  }
  for (const sport of sports) {
    const url = `${endpointBase}/eventsday.php?d=${encodeURIComponent(date)}&s=${encodeURIComponent(sport)}`;
    try {
      const payload = await fetchJsonWithTimeout(url, timeoutMs);
      const rows = Array.isArray(payload?.events) ? payload.events : [];
      for (const row of rows) {
        events.push({
          ...row,
          __dayDate: date,
          __daySport: sport,
          __endpoint: "eventsday.php",
        });
      }
    } catch (error) {
      diagnostics.failedSports.push({
        sport,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  diagnostics.fetchedCount = events.length;
  return {
    events,
    diagnostics,
  };
}

async function fetchTeamsByLeagueNames(args = {}) {
  const apiKey = String(args.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3").trim() || "3";
  const leagues = Array.isArray(args.leagues)
    ? args.leagues.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 5000;
  const endpointBase = `${SPORTSDB_BASE_URL}/${encodeURIComponent(apiKey)}`;
  const teams = [];
  const diagnostics = {
    provider: "thesportsdb",
    endpointUsed: "search_all_teams.php",
    leaguesQueried: leagues,
    fetchedCount: 0,
    failedLeagues: [],
    apiKeyMode: apiKey === "3" ? "public_test_key" : "configured_key",
  };
  for (const leagueName of leagues) {
    const url = `${endpointBase}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`;
    try {
      const payload = await fetchJsonWithTimeout(url, timeoutMs);
      const rows = Array.isArray(payload?.teams) ? payload.teams : [];
      for (const row of rows) {
        teams.push({
          ...row,
          __leagueName: leagueName,
          __endpoint: "search_all_teams.php",
        });
      }
    } catch (error) {
      diagnostics.failedLeagues.push({
        league: leagueName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  diagnostics.fetchedCount = teams.length;
  return {
    teams,
    diagnostics,
  };
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const abortController = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = setTimeout(() => abortController?.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: abortController?.signal,
    });
    if (!response.ok) {
      throw new Error(`sportsdb_http_${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  DEFAULT_SUPPORTED_SPORTS,
  DEFAULT_LEAGUES,
  DEFAULT_TEAM_LOOKUP_LEAGUES,
  fetchUpcomingLeagueEvents,
  fetchEventsBySearchTerms,
  fetchEventsByDayAndSports,
  fetchTeamsByLeagueNames,
};
