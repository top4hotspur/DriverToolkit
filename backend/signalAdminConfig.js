const fs = require("fs");
const path = require("path");

function createSignalAdminConfig(options) {
  const { uploadsDir } = options;
  const filePath = path.join(uploadsDir, "signal-admin-config.json");
  const defaults = {
    providers: {
      translink: {
        enabled: true,
      },
      sportsdb: {
        enabled: true,
      },
      ticketmaster: {
        enabled: true,
      },
    },
    translink: {
      busyMultiplier: 1.1,
      veryBusyMultiplier: 1.5,
      defaultProximityRadiusMiles: 5,
      trackedHubKeys: [
        "belfast_central",
        "great_victoria_street",
        "bangor",
      ],
    },
    sportsdb: {
      timeoutMs: 5000,
      country: "United Kingdom",
      city: "Belfast",
    },
    ticketmaster: {
      timeoutMs: 6500,
      countryCode: "GB",
      city: "Belfast",
      size: 100,
    },
  };

  let state = defaults;
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      state = mergeConfig(defaults, parsed);
    } catch {
      state = defaults;
    }
  }

  function save() {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  }

  function get() {
    return state;
  }

  function update(partial) {
    state = mergeConfig(state, partial ?? {});
    save();
    return state;
  }

  return {
    get,
    update,
    path: filePath,
  };
}

function mergeConfig(base, patch) {
  const merged = {
    ...base,
    ...patch,
    providers: {
      ...(base.providers ?? {}),
      ...(patch.providers ?? {}),
      translink: {
        ...(base.providers?.translink ?? {}),
        ...(patch.providers?.translink ?? {}),
      },
      sportsdb: {
        ...(base.providers?.sportsdb ?? {}),
        ...(patch.providers?.sportsdb ?? {}),
      },
      ticketmaster: {
        ...(base.providers?.ticketmaster ?? {}),
        ...(patch.providers?.ticketmaster ?? {}),
      },
    },
    translink: {
      ...(base.translink ?? {}),
      ...(patch.translink ?? {}),
      trackedHubKeys: Array.isArray(patch.translink?.trackedHubKeys)
        ? patch.translink.trackedHubKeys
        : base.translink?.trackedHubKeys ?? [],
    },
    sportsdb: {
      ...(base.sportsdb ?? {}),
      ...(patch.sportsdb ?? {}),
      leagues: Array.isArray(patch.sportsdb?.leagues)
        ? patch.sportsdb.leagues
        : base.sportsdb?.leagues ?? undefined,
    },
    ticketmaster: {
      ...(base.ticketmaster ?? {}),
      ...(patch.ticketmaster ?? {}),
    },
  };
  return merged;
}

module.exports = {
  createSignalAdminConfig,
};
