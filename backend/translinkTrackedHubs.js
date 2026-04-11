const TRANSLINK_TRACKED_HUBS = [
  {
    hubKey: "belfast_central",
    displayName: "Lanyon Place",
    stopId: "TRANSLINK_BELFAST_CENTRAL",
    localityId: "TRANSLINK_BELFAST_CENTRAL",
    sourceRefs: [
      {
        sourceKey: "rail_primary",
        mode: "train",
        stopFinderQuery: "Lanyon Place",
        fallbackStopId: "TRANSLINK_BELFAST_CENTRAL",
      },
    ],
    lat: 54.5966,
    lng: -5.9187,
    postcode: "BT1",
    regionKey: "uk-ni",
    city: "belfast",
  },
  {
    hubKey: "great_victoria_street",
    displayName: "Grand Central",
    stopId: "TRANSLINK_GVS",
    localityId: "TRANSLINK_GVS",
    sourceRefs: [
      {
        sourceKey: "rail_primary",
        mode: "train",
        stopFinderQuery: "Grand Central",
        fallbackStopId: "TRANSLINK_GVS_RAIL",
      },
      {
        sourceKey: "bus_primary",
        mode: "bus",
        stopFinderQuery: "Grand Central Bus",
        fallbackStopId: "TRANSLINK_GVS_BUS",
      },
    ],
    lat: 54.5922,
    lng: -5.9342,
    postcode: "BT12",
    regionKey: "uk-ni",
    city: "belfast",
  },
  {
    hubKey: "bangor",
    displayName: "Bangor",
    stopId: "TRANSLINK_BANGOR",
    localityId: "TRANSLINK_BANGOR",
    sourceRefs: [
      {
        sourceKey: "rail_primary",
        mode: "train",
        stopFinderQuery: "Bangor",
        fallbackStopId: "TRANSLINK_BANGOR",
      },
    ],
    lat: 54.6648,
    lng: -5.6691,
    postcode: "BT20",
    regionKey: "uk-ni",
    city: "bangor",
  },
];

function listTranslinkTrackedHubs() {
  return [...TRANSLINK_TRACKED_HUBS];
}

function getTranslinkHubByKey(hubKey) {
  return TRANSLINK_TRACKED_HUBS.find((hub) => hub.hubKey === hubKey) ?? null;
}

module.exports = {
  listTranslinkTrackedHubs,
  getTranslinkHubByKey,
};
