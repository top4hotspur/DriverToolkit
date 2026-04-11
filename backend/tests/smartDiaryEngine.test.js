const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSmartDiarySignalEngine } = require("../smartDiaryEngine");

function makeTmpUploadsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dt-smart-diary-"));
}

function makeTranslinkStub() {
  return {
    getSmartDiarySignalForHub: async (hubKey) => ({
      currentHub: {
        hubKey,
        hubName: "Hub",
        stopId: "STOP_1",
      },
      nextHourExpectedArrivalsCount: 6,
      baselineCount: 3,
      status: "busy",
      cancellationsCountInNextHour: 0,
      alertItems: [],
      nextThree: [
        { time: "10:05", origin: "A", destination: "B", timeIso: new Date().toISOString() },
      ],
    }),
  };
}

test("smart diary engine marks active locations from driver context", async () => {
  const uploadsDir = makeTmpUploadsDir();
  const engine = createSmartDiarySignalEngine({
    uploadsDir,
    translinkRail: makeTranslinkStub(),
  });

  engine.upsertDriverContext({
    driverId: "driver_a",
    online: true,
    latitude: 54.5966,
    longitude: -5.9187,
    savedPostcodes: ["BT2"],
    favouriteLocationIds: ["loc_sse_arena"],
  });

  const active = engine.getActiveLocations();
  assert.ok(active.length > 0);
  const activeIds = new Set(active.map((location) => location.id));
  assert.ok(activeIds.has("loc_rail_belfast_central"));
  assert.ok(activeIds.has("loc_sse_arena"));
});

test("smart diary feed returns normalized backend-only payload", async () => {
  const uploadsDir = makeTmpUploadsDir();
  const engine = createSmartDiarySignalEngine({
    uploadsDir,
    translinkRail: makeTranslinkStub(),
  });

  engine.upsertDriverContext({
    driverId: "driver_b",
    online: true,
    latitude: 54.5966,
    longitude: -5.9187,
    savedPostcodes: ["BT2"],
  });

  await engine.pollAllActiveSources();
  const payload = engine.buildSmartDiaryPayload({ driverId: "driver_b" });

  assert.equal(payload.notes.noPerDriverExternalApiCalls, true);
  assert.equal(payload.notes.clientCallsBackendOnly, true);
  assert.ok(Array.isArray(payload.allRelevantSignals));
  assert.ok(payload.allRelevantSignals.length >= 1);
  assert.ok(
    payload.allRelevantSignals.every((signal) =>
      ["normal", "elevated", "high"].includes(signal.impactLevel),
    ),
  );
});
