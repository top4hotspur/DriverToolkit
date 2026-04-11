const fs = require("fs");
const path = require("path");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values;
}

function parseCsvText(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => String(h).trim().replace(/^\uFEFF/, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

function csvEscape(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function toNum(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value).trim());
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function getDayHourBucket(timestampIso) {
  if (!timestampIso) return null;
  const d = new Date(timestampIso);
  if (Number.isNaN(d.getTime())) return null;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getUTCDay()]}-${String(d.getUTCHours()).padStart(2, "0")}`;
}

function getDateBucket(timestampIso) {
  if (!timestampIso) return null;
  const d = new Date(timestampIso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function toZone(row) {
  const label = row.beginAreaLabel || row.requestAreaLabel || row.dropoffAreaLabel;
  if (label) return label;
  const lat = toNum(row.beginLat) ?? toNum(row.requestLat) ?? toNum(row.dropoffLat);
  const lng = toNum(row.beginLng) ?? toNum(row.requestLng) ?? toNum(row.dropoffLng);
  if (lat == null || lng == null) return "Unknown zone";
  return `grid_${lat.toFixed(2)}_${lng.toFixed(2)}`;
}

function confidenceWeight(row) {
  const confidence = String(row.matchConfidence || "").toLowerCase();
  if (confidence === "strict") return 1.0;
  if (confidence === "good") return 0.8;
  return 0;
}

function confidenceLevel(weightedTripCount) {
  if (weightedTripCount < 10) return "low-confidence";
  if (weightedTripCount < 20) return "medium-confidence";
  return "high-confidence";
}

function buildEnrichedHeatmap(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const beginMatched = String(row.beginMatched || "").toLowerCase() === "true";
    const dropoffMatched = String(row.dropoffMatched || "").toLowerCase() === "true";
    if (!beginMatched || !dropoffMatched) continue;

    const w = confidenceWeight(row);
    if (w <= 0) continue;

    const ts = toIso(row.beginTripTimestampLocal);
    const timeBucket = getDayHourBucket(ts);
    const dateBucket = getDateBucket(ts);
    if (!timeBucket || !dateBucket) continue;

    const zone = toZone(row);
    const fare = toNum(row.originalFareLocal) ?? 0;
    const key = `${zone}||${timeBucket}`;
    const entry = buckets.get(key) ?? {
      zone,
      timeBucket,
      weightedTripCount: 0,
      weightedFareSum: 0,
      observedDates: new Set(),
    };
    entry.weightedTripCount += w;
    entry.weightedFareSum += fare * w;
    entry.observedDates.add(dateBucket);
    buckets.set(key, entry);
  }

  const enriched = [];
  for (const entry of buckets.values()) {
    if (entry.weightedTripCount < 5) continue;
    const avgFare = entry.weightedTripCount > 0 ? entry.weightedFareSum / entry.weightedTripCount : 0;
    const observedHours = Math.max(1, entry.observedDates.size);
    const tripsPerHour = entry.weightedTripCount / observedHours;
    const earningsPerHour = avgFare * tripsPerHour;
    enriched.push({
      zone: entry.zone,
      timeBucket: entry.timeBucket,
      weightedTripCount: Number(entry.weightedTripCount.toFixed(3)),
      avgFare: Number(avgFare.toFixed(2)),
      tripsPerHour: Number(tripsPerHour.toFixed(3)),
      earningsPerHour: Number(earningsPerHour.toFixed(2)),
      confidenceLevel: confidenceLevel(entry.weightedTripCount),
      observedHours,
    });
  }

  enriched.sort((a, b) => {
    if (a.timeBucket !== b.timeBucket) return a.timeBucket.localeCompare(b.timeBucket);
    if (b.earningsPerHour !== a.earningsPerHour) return b.earningsPerHour - a.earningsPerHour;
    return b.weightedTripCount - a.weightedTripCount;
  });

  return enriched;
}

function buildBestZonesByTime(enrichedRows) {
  const byTime = new Map();
  for (const row of enrichedRows) {
    const list = byTime.get(row.timeBucket) ?? [];
    list.push(row);
    byTime.set(row.timeBucket, list);
  }
  const output = {};
  for (const [timeBucket, list] of byTime.entries()) {
    list.sort((a, b) => b.earningsPerHour - a.earningsPerHour);
    output[timeBucket] = list.slice(0, 3).map((row, idx) => ({
      rank: idx + 1,
      zone: row.zone,
      earningsPerHour: row.earningsPerHour,
      avgFare: row.avgFare,
      tripsPerHour: row.tripsPerHour,
      weightedTripCount: row.weightedTripCount,
      confidenceLevel: row.confidenceLevel,
    }));
  }
  return output;
}

function buildDecisionSample(enrichedRows, currentZone, currentTimeBucket) {
  const candidates = enrichedRows
    .filter((row) => row.timeBucket === currentTimeBucket)
    .sort((a, b) => b.earningsPerHour - a.earningsPerHour);

  const current = candidates.find((row) => row.zone === currentZone) ?? null;
  const best = candidates[0] ?? null;
  const bestAlternative = candidates.find((row) => row.zone !== currentZone) ?? best;

  if (!bestAlternative) {
    return {
      currentZone,
      currentTimeBucket,
      recommendation: "stay",
      reason: "No comparable zones available for this time bucket.",
    };
  }

  if (!current) {
    return {
      currentZone,
      currentTimeBucket,
      bestAlternativeZone: bestAlternative.zone,
      bestAlternativeEarningsPerHour: bestAlternative.earningsPerHour,
      currentZoneEarningsPerHour: null,
      earningsDeltaPercent: null,
      recommendation: "move",
      reason: "No calibrated baseline for current zone in this time bucket.",
      confidenceLevel: bestAlternative.confidenceLevel,
    };
  }

  const deltaPct =
    current.earningsPerHour > 0
      ? ((bestAlternative.earningsPerHour - current.earningsPerHour) / current.earningsPerHour) * 100
      : null;
  const recommendation =
    deltaPct != null && deltaPct >= 10 ? "move" : "stay";

  return {
    currentZone,
    currentTimeBucket,
    bestAlternativeZone: bestAlternative.zone,
    bestAlternativeEarningsPerHour: bestAlternative.earningsPerHour,
    currentZoneEarningsPerHour: Number(current.earningsPerHour.toFixed(2)),
    earningsDeltaPercent: deltaPct == null ? null : Number(deltaPct.toFixed(2)),
    recommendation,
    confidenceLevel: bestAlternative.confidenceLevel,
    note:
      recommendation === "move"
        ? "Alternative zone shows materially higher expected earnings per hour."
        : "Current zone remains competitive for this time bucket.",
  };
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function main() {
  const inputPath = getArg(
    "input",
    path.join(__dirname, "uploads", "experiments", "trip_first", "timeline_trip_match_120s.csv"),
  );
  const outDir = getArg(
    "outDir",
    path.join(__dirname, "uploads", "experiments", "trip_first"),
  );
  const currentZoneArg = getArg("currentZone", "Belfast City Centre");
  const currentTimeBucketArg = getArg("currentTimeBucket", "Fri-17");

  fs.mkdirSync(outDir, { recursive: true });

  const parsed = parseCsvText(fs.readFileSync(inputPath, "utf8"));
  const enriched = buildEnrichedHeatmap(parsed.rows);
  const bestZonesByTime = buildBestZonesByTime(enriched);
  const decisionSample = buildDecisionSample(enriched, currentZoneArg, currentTimeBucketArg);

  const enrichedCsvPath = path.join(outDir, "heatmap_enriched.csv");
  const bestZonesPath = path.join(outDir, "best_zones_by_time.json");
  const decisionSamplePath = path.join(outDir, "decision_engine_sample.json");

  writeCsv(enrichedCsvPath, enriched, [
    "zone",
    "timeBucket",
    "weightedTripCount",
    "avgFare",
    "tripsPerHour",
    "earningsPerHour",
    "confidenceLevel",
  ]);
  fs.writeFileSync(bestZonesPath, `${JSON.stringify(bestZonesByTime, null, 2)}\n`, "utf8");
  fs.writeFileSync(decisionSamplePath, `${JSON.stringify(decisionSample, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        files: {
          heatmapEnriched: enrichedCsvPath,
          bestZonesByTime: bestZonesPath,
          decisionEngineSample: decisionSamplePath,
        },
        sampleTop: Object.entries(bestZonesByTime).slice(0, 3),
        decisionSample,
      },
      null,
      2,
    ),
  );
}

main();
