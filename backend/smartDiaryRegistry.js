const MVP_LOCATIONS = [
  {
    id: "loc_bhd_airport",
    name: "Belfast City Airport",
    type: "airport",
    lat: 54.6181,
    lng: -5.8725,
    postcode: "BT3",
    sources: {
      airport: { airportCode: "BHD" },
    },
  },
  {
    id: "loc_bfs_airport",
    name: "Belfast International Airport",
    type: "airport",
    lat: 54.6575,
    lng: -6.2158,
    postcode: "BT29",
    sources: {
      airport: { airportCode: "BFS" },
    },
  },
  {
    id: "loc_rail_belfast_central",
    name: "Belfast Central",
    type: "train",
    lat: 54.5966,
    lng: -5.9187,
    postcode: "BT2",
    sources: {
      translink: { hubKey: "belfast_central" },
    },
  },
  {
    id: "loc_rail_gvs",
    name: "Great Victoria Street",
    type: "train",
    lat: 54.5922,
    lng: -5.9342,
    postcode: "BT2",
    sources: {
      translink: { hubKey: "great_victoria_street" },
    },
  },
  {
    id: "loc_rail_bangor",
    name: "Bangor",
    type: "train",
    lat: 54.6648,
    lng: -5.6691,
    postcode: "BT20",
    sources: {
      translink: { hubKey: "bangor" },
    },
  },
  {
    id: "loc_sse_arena",
    name: "SSE Arena",
    type: "concert",
    lat: 54.6019,
    lng: -5.9153,
    postcode: "BT3",
    sources: {
      ticketmaster: {
        keyword: "SSE Arena Belfast",
        venueId: "KovZpZA7FAEA",
      },
    },
  },
  {
    id: "loc_windsor_park",
    name: "Windsor Park",
    type: "sport",
    lat: 54.5806,
    lng: -5.9615,
    postcode: "BT9",
    sources: {
      sportsdb: {
        venueName: "Windsor Park",
        venueId: null,
        teamHint: "Linfield",
      },
      ticketmaster: {
        keyword: "Windsor Park Belfast",
        venueId: null,
      },
    },
  },
];

function normalizePostcode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function listMvpLocations() {
  return MVP_LOCATIONS.map((location) => ({
    ...location,
    postcode: normalizePostcode(location.postcode),
  }));
}

function getLocationById(locationId) {
  const location = MVP_LOCATIONS.find((loc) => loc.id === locationId) ?? null;
  if (!location) return null;
  return {
    ...location,
    postcode: normalizePostcode(location.postcode),
  };
}

function listLocationsBySource(sourceKey) {
  return listMvpLocations().filter((location) => location.sources?.[sourceKey]);
}

function getLocationByPostcode(postcode) {
  const normalized = normalizePostcode(postcode);
  if (!normalized) return null;
  return listMvpLocations().find((location) => location.postcode === normalized) ?? null;
}

module.exports = {
  listMvpLocations,
  getLocationById,
  listLocationsBySource,
  getLocationByPostcode,
  normalizePostcode,
};
