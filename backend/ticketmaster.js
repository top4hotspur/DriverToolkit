const TICKETMASTER_BASE_URL = "https://app.ticketmaster.com/discovery/v2";

async function fetchUpcomingEvents(args = {}) {
  const apiKey = String(args.apiKey ?? process.env.TICKETMASTER_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      events: [],
      diagnostics: {
        provider: "ticketmaster",
        providerStatus: "missing_api_key",
        endpointUsed: "events.json",
        eventsFetchedCount: 0,
        countriesQueried: [],
        venuesQueried: [],
      },
    };
  }

  const now = args.now ? new Date(args.now) : new Date();
  const startIso = now.toISOString();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endIso = end.toISOString();
  const countryCode = normalizeCountryCode(args.countryCode ?? args.country ?? "GB");
  const city = String(args.city ?? "").trim();
  const size = Number.isFinite(Number(args.size)) ? Math.max(1, Math.min(200, Number(args.size))) : 100;
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 6500;

  const url = new URL(`${TICKETMASTER_BASE_URL}/events.json`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("startDateTime", startIso);
  url.searchParams.set("endDateTime", endIso);
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("size", String(size));
  if (countryCode) {
    url.searchParams.set("countryCode", countryCode);
  }
  if (city) {
    url.searchParams.set("city", city);
  }

  const payload = await fetchJsonWithTimeout(url.toString(), timeoutMs);
  const rows = Array.isArray(payload?._embedded?.events) ? payload._embedded.events : [];
  return {
    events: rows,
    diagnostics: {
      provider: "ticketmaster",
      providerStatus: "ok",
      endpointUsed: "events.json",
      eventsFetchedCount: rows.length,
      countriesQueried: countryCode ? [countryCode] : [],
      venuesQueried: [],
      request: {
        startDateTime: startIso,
        endDateTime: endIso,
        city: city || null,
      },
    },
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
      throw new Error(`ticketmaster_http_${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeCountryCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "UK" || raw === "UNITED KINGDOM" || raw === "GBR") return "GB";
  return raw.length > 2 ? raw.slice(0, 2) : raw;
}

module.exports = {
  fetchUpcomingEvents,
};

