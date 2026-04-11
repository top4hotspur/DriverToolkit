const PROVIDER_REGISTRY = [
  {
    providerKey: "translink",
    name: "Translink",
    category: "transport",
    enabled: true,
    coverage: {
      countries: ["GB"],
      regions: ["uk-ni"],
      cities: ["belfast", "bangor"],
    },
    pollingSchedule: {
      everyMinutes: 5,
    },
    supportedSignalTypes: [
      "busy",
      "very_busy",
      "cancellation",
      "disruption",
      "proximity",
    ],
    authEnvKeyRef: "TRANSLINK_API_TOKEN",
  },
  {
    providerKey: "airport_api",
    name: "Airport Signals",
    category: "flight",
    enabled: false,
    coverage: {
      countries: ["GB"],
      regions: ["uk-ni"],
      cities: ["belfast"],
    },
    pollingSchedule: {
      everyMinutes: 15,
    },
    supportedSignalTypes: ["busy", "very_busy", "disruption"],
    authEnvKeyRef: "AIRPORT_API_KEY",
  },
  {
    providerKey: "ticketmaster",
    name: "Ticketmaster Events",
    category: "event",
    enabled: true,
    coverage: {
      countries: ["GB"],
      regions: ["uk-ni"],
      cities: ["belfast"],
    },
    pollingSchedule: {
      everyMinutes: 45,
    },
    supportedSignalTypes: ["events_pre_arrivals", "events_post_dispersal"],
    authEnvKeyRef: "TICKETMASTER_API_KEY",
  },
  {
    providerKey: "sportsdb",
    name: "TheSportsDB",
    category: "sports",
    enabled: true,
    coverage: {
      countries: ["GB"],
      regions: ["uk-ni"],
      cities: ["belfast"],
    },
    pollingSchedule: {
      everyMinutes: 10,
    },
    supportedSignalTypes: ["sports_pre_event_arrivals", "sports_post_event_dispersal"],
    authEnvKeyRef: "SPORTSDB_API_KEY",
  },
  {
    providerKey: "weather",
    name: "Weather Provider",
    category: "weather",
    enabled: false,
    coverage: {
      countries: ["GB"],
      regions: ["uk-ni"],
      cities: [],
    },
    pollingSchedule: {
      everyMinutes: 30,
    },
    supportedSignalTypes: ["weather_warning"],
    authEnvKeyRef: "WEATHER_API_KEY",
  },
  {
    providerKey: "parade_disruption",
    name: "Parade/Disruption Feed",
    category: "disruption",
    enabled: false,
    coverage: {
      countries: ["GB"],
      regions: ["uk-ni"],
      cities: ["belfast"],
    },
    pollingSchedule: {
      everyMinutes: 30,
    },
    supportedSignalTypes: ["planned_disruption", "disruption"],
    authEnvKeyRef: "PARADE_FEED_API_KEY",
  },
];

function listProviderRegistry() {
  return [...PROVIDER_REGISTRY];
}

function getProviderByKey(providerKey) {
  return PROVIDER_REGISTRY.find((provider) => provider.providerKey === providerKey) ?? null;
}

module.exports = {
  listProviderRegistry,
  getProviderByKey,
};
