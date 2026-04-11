const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  buildTimelineIndex,
  buildRawSignalIndex,
  correlateHistoricalTripsWithTimeline,
  parseTimelineFileChunked,
} = require("../timelineBackfill");

test("timeline parser reads line-delimited segments", async () => {
  const fixturePath = path.join(__dirname, "timeline-fixture.ndjson");
  const lines = [
    JSON.stringify({
      timelinePath: {
        startTime: "2026-01-01T10:00:00Z",
        endTime: "2026-01-01T10:10:00Z",
        startLat: 54.59,
        startLng: -5.93,
        endLat: 54.6,
        endLng: -5.92,
        distanceMeters: 2000,
      },
    }),
    JSON.stringify({
      activity: {
        startTime: "2026-01-01T10:12:00Z",
        endTime: "2026-01-01T10:20:00Z",
        startLat: 54.61,
        startLng: -5.91,
        semanticType: "IN_VEHICLE",
      },
    }),
  ];
  fs.writeFileSync(fixturePath, lines.join("\n"), "utf8");
  const parsed = await parseTimelineFileChunked(fixturePath, "test-source");
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.diagnostics.mode, "stream-object");
  fs.unlinkSync(fixturePath);
});

test("timeline parser reads array JSON via streaming", async () => {
  const fixturePath = path.join(__dirname, "timeline-fixture-array.json");
  const payload = [
    {
      timelinePath: {
        startTime: "2026-02-01T09:00:00Z",
        endTime: "2026-02-01T09:08:00Z",
        startLat: 54.6,
        startLng: -5.92,
      },
    },
    {
      visit: {
        startTime: "2026-02-01T09:10:00Z",
        endTime: "2026-02-01T09:40:00Z",
        startLat: 54.61,
        startLng: -5.91,
      },
    },
  ];
  fs.writeFileSync(fixturePath, JSON.stringify(payload, null, 2), "utf8");
  const parsed = await parseTimelineFileChunked(fixturePath, "test-source");
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.diagnostics.mode, "stream-object");
  fs.unlinkSync(fixturePath);
});

test("timeline parser supports semanticSegments root object", async () => {
  const fixturePath = path.join(__dirname, "timeline-fixture-semantic.json");
  const payload = {
    semanticSegments: [
      {
        startTime: "2026-02-01T08:00:00Z",
        endTime: "2026-02-01T08:10:00Z",
        timelinePath: {
          points: [
            { latLng: "geo:54.597,-5.930" },
            { latLng: "geo:54.603,-5.910" },
          ],
        },
      },
      {
        startTime: "2026-02-01T09:00:00Z",
        endTime: "2026-02-01T09:20:00Z",
        activity: {
          start: { latLng: "geo:54.610,-5.920" },
          end: { latLng: "geo:54.620,-5.900" },
          distanceMeters: 3200,
          topCandidate: { type: "IN_VEHICLE" },
        },
      },
      {
        startTime: "2026-02-01T10:00:00Z",
        endTime: "2026-02-01T10:30:00Z",
        visit: {
          topCandidate: {
            placeLocation: { latLng: "geo:54.588,-5.930" },
            semanticType: "WORK",
          },
        },
      },
    ],
  };
  fs.writeFileSync(fixturePath, JSON.stringify(payload, null, 2), "utf8");
  const parsed = await parseTimelineFileChunked(fixturePath, "test-source");
  assert.equal(parsed.segments.length, 3);
  assert.equal(parsed.diagnostics.formatDetected, "google-takeout-semanticSegments");
  assert.equal(parsed.diagnostics.emittedBySubtype.timelinePath, 1);
  assert.equal(parsed.diagnostics.emittedBySubtype.activity, 1);
  assert.equal(parsed.diagnostics.emittedBySubtype.visit, 1);
  fs.unlinkSync(fixturePath);
});

test("correlation produces inferred match", () => {
  const segments = [
    {
      segmentType: "timelinePath",
      startTime: "2026-01-01T10:00:00Z",
      endTime: "2026-01-01T10:10:00Z",
      startLat: 54.59,
      startLng: -5.93,
      endLat: 54.6,
      endLng: -5.92,
      distanceMeters: 1200,
      semanticType: "timelinePath",
      sourceFileId: "src",
      dateBucket: "2026-01",
    },
  ];
  const index = buildTimelineIndex(segments);
  const result = correlateHistoricalTripsWithTimeline({
    importId: "import_test",
    sequenceSuggestions: [
      {
        tripRequestTimestamp: "2026-01-01T10:05:00Z",
        estimatedEarnings: 12.5,
        durationSeconds: 600,
        distanceMiles: 0.7,
      },
    ],
    segmentsByBucket: index,
    rawSignalsByBucket: new Map(),
  });
  const inferred = result.inferred;
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0].source, "google_timeline_inferred");
  assert.equal(typeof result.metrics.timelineCandidatesFound, "number");
});

test("correlation downgrades non-unique fits to review", () => {
  const segments = [
    {
      segmentType: "timelinePath",
      startTime: "2026-01-01T10:00:00Z",
      endTime: "2026-01-01T10:10:00Z",
      startLat: 54.59,
      startLng: -5.93,
      endLat: 54.6,
      endLng: -5.92,
      distanceMeters: 1200,
      semanticType: "timelinePath",
      sourceFileId: "src",
      dateBucket: "2026-01",
    },
    {
      segmentType: "timelinePath",
      startTime: "2026-01-01T10:01:00Z",
      endTime: "2026-01-01T10:11:00Z",
      startLat: 54.5905,
      startLng: -5.9305,
      endLat: 54.6005,
      endLng: -5.9205,
      distanceMeters: 1250,
      semanticType: "timelinePath",
      sourceFileId: "src",
      dateBucket: "2026-01",
    },
  ];
  const index = buildTimelineIndex(segments);
  const result = correlateHistoricalTripsWithTimeline({
    importId: "import_test",
    sequenceSuggestions: [
      {
        tripRequestTimestamp: "2026-01-01T10:05:00Z",
        estimatedEarnings: 9.5,
        durationSeconds: 600,
        distanceMiles: 0.7,
      },
    ],
    segmentsByBucket: index,
    rawSignalsByBucket: new Map(),
  });
  assert.equal(result.inferred.length, 1);
  assert.equal(result.inferred[0].confidence, "review");
  assert.equal(result.metrics.nonUniqueRejected >= 1, true);
});

test("correlation emits score diagnostics and scored samples", () => {
  const segments = [
    {
      segmentType: "timelinePath",
      startTime: "2026-01-01T10:00:00Z",
      endTime: "2026-01-01T10:10:00Z",
      startLat: 54.59,
      startLng: -5.93,
      endLat: 54.6,
      endLng: -5.92,
      distanceMeters: 1200,
      semanticType: "timelinePath",
      sourceFileId: "src",
      dateBucket: "2026-01",
    },
  ];
  const index = buildTimelineIndex(segments);
  const result = correlateHistoricalTripsWithTimeline({
    importId: "import_diag",
    sequenceSuggestions: [
      {
        tripRequestTimestamp: "2026-01-01T10:05:00Z",
        estimatedEarnings: 11.2,
        durationSeconds: 600,
        distanceMiles: 0.8,
        areaHint: "Belfast City Centre",
      },
    ],
    segmentsByBucket: index,
    rawSignalsByBucket: new Map(),
  });

  assert.equal(Array.isArray(result.scoredSamples), true);
  assert.equal(result.scoredSamples.length, 1);
  assert.equal(typeof result.scoredSamples[0].finalScore, "number");
  assert.equal(typeof result.scoredSamples[0].timestampScore, "number");
  assert.equal(typeof result.scoredSamples[0].durationScore, "number");
  assert.equal(typeof result.scoredSamples[0].distanceScore, "number");
  assert.equal(result.metrics.scoreHistogram != null, true);
  assert.equal(result.metrics.promotionBlockers != null, true);
  assert.equal(result.metrics.scoringPathDiagnostics != null, true);
  assert.equal(result.metrics.scoringInputCounts != null, true);
});

test("timeline parser extracts rawSignals.position with LatLng shape", async () => {
  const fixturePath = path.join(__dirname, "timeline-fixture-rawsignals.json");
  const payload = {
    semanticSegments: [],
    rawSignals: [
      {
        position: {
          LatLng: "54.5711522°, -5.8917284°",
          timestamp: "2026-03-04T11:17:14.000+00:00",
        },
      },
      { wifiScan: { timestamp: "2026-03-04T11:17:20.000+00:00" } },
    ],
  };
  fs.writeFileSync(fixturePath, JSON.stringify(payload, null, 2), "utf8");
  const parsed = await parseTimelineFileChunked(fixturePath, "test-source");
  const index = buildRawSignalIndex(parsed.rawSignalPositions);
  const count = Array.from(index.values()).reduce((acc, points) => acc + points.length, 0);
  assert.equal(count, 1);
  assert.equal(parsed.diagnostics.rawSignalsDiagnostics.positionEntriesSeen >= 1, true);
  assert.equal(parsed.diagnostics.rawSignalsDiagnostics.extractedPointCount >= 1, true);
  fs.unlinkSync(fixturePath);
});
