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

function toZone(row) {
  const label = row.beginAreaLabel || row.requestAreaLabel || row.dropoffAreaLabel;
  if (label) return label;
  const lat = toNum(row.beginLat) ?? toNum(row.requestLat) ?? toNum(row.dropoffLat);
  const lng = toNum(row.beginLng) ?? toNum(row.requestLng) ?? toNum(row.dropoffLng);
  if (lat == null || lng == null) return "Unknown zone";
  return `grid_${lat.toFixed(2)}_${lng.toFixed(2)}`;
}

function confidenceBand(row) {
  const confidence = String(row.matchConfidence || "").toLowerCase();
  if (confidence === "strict") return "high";
  if (confidence === "good") return "medium";
  return "other";
}

function buildHeatmapRows(baseRows, includeFn) {
  const map = new Map();
  for (const row of baseRows) {
    if (!includeFn(row)) continue;
    const zone = toZone(row);
    const timeBucket = getDayHourBucket(toIso(row.beginTripTimestampLocal));
    if (!timeBucket) continue;
    const metricComponent = toNum(row.originalFareLocal) ?? 0;
    const key = `${zone}||${timeBucket}`;
    const entry = map.get(key) ?? {
      zone,
      timeBucket,
      tripCount: 0,
      metricSum: 0,
    };
    entry.tripCount += 1;
    entry.metricSum += metricComponent;
    map.set(key, entry);
  }

  const groupedByTime = new Map();
  for (const entry of map.values()) {
    const metricValue = entry.tripCount > 0 ? entry.metricSum / entry.tripCount : 0;
    const row = {
      zone: entry.zone,
      timeBucket: entry.timeBucket,
      tripCount: entry.tripCount,
      metricValue,
      rankWithinTimeBucket: null,
    };
    const list = groupedByTime.get(entry.timeBucket) ?? [];
    list.push(row);
    groupedByTime.set(entry.timeBucket, list);
  }

  const outputRows = [];
  for (const [timeBucket, list] of groupedByTime.entries()) {
    list.sort((a, b) => {
      if (b.metricValue !== a.metricValue) return b.metricValue - a.metricValue;
      if (b.tripCount !== a.tripCount) return b.tripCount - a.tripCount;
      return a.zone.localeCompare(b.zone);
    });
    list.forEach((row, idx) => {
      row.rankWithinTimeBucket = idx + 1;
      outputRows.push(row);
    });
  }

  outputRows.sort((a, b) => {
    if (a.timeBucket !== b.timeBucket) return a.timeBucket.localeCompare(b.timeBucket);
    return a.rankWithinTimeBucket - b.rankWithinTimeBucket;
  });
  return outputRows;
}

function indexByKey(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.zone}||${row.timeBucket}`, row);
  }
  return map;
}

function stabilityLabel(metricPctDelta, rankChange, tripCountDelta) {
  const pct = metricPctDelta == null ? 0 : Math.abs(metricPctDelta);
  const rank = Math.abs(rankChange);
  const trip = Math.abs(tripCountDelta);
  if (pct >= 30 || rank >= 5 || trip >= 20) return "high";
  if (pct >= 10 || rank >= 2 || trip >= 5) return "moderate";
  return "low";
}

function buildComparison(highOnlyRows, highPlusMediumRows) {
  const highMap = indexByKey(highOnlyRows);
  const hpmMap = indexByKey(highPlusMediumRows);
  const keys = new Set([...highMap.keys(), ...hpmMap.keys()]);
  const rows = [];
  for (const key of keys) {
    const high = highMap.get(key);
    const hpm = hpmMap.get(key);
    const zone = high?.zone ?? hpm?.zone ?? "Unknown zone";
    const timeBucket = high?.timeBucket ?? hpm?.timeBucket ?? "Unknown";
    const highTripCount = high?.tripCount ?? 0;
    const hpmTripCount = hpm?.tripCount ?? 0;
    const highMetric = high?.metricValue ?? 0;
    const hpmMetric = hpm?.metricValue ?? 0;
    const highRank = high?.rankWithinTimeBucket ?? null;
    const hpmRank = hpm?.rankWithinTimeBucket ?? null;
    const tripCountDelta = hpmTripCount - highTripCount;
    const metricAbsDelta = hpmMetric - highMetric;
    const metricPctDelta = highMetric === 0 ? null : (metricAbsDelta / highMetric) * 100;
    const rankChange =
      highRank == null || hpmRank == null
        ? 0
        : highRank - hpmRank;
    const label = stabilityLabel(metricPctDelta, rankChange, tripCountDelta);
    rows.push({
      zone,
      timeBucket,
      highOnlyTripCount: highTripCount,
      highPlusMediumTripCount: hpmTripCount,
      tripCountDelta,
      highOnlyMetricValue: highMetric,
      highPlusMediumMetricValue: hpmMetric,
      metricAbsoluteDelta: metricAbsDelta,
      metricPercentageDelta: metricPctDelta,
      highOnlyRank: highRank,
      highPlusMediumRank: hpmRank,
      rankChange,
      stabilityLabel: label,
    });
  }
  rows.sort((a, b) => {
    if (a.timeBucket !== b.timeBucket) return a.timeBucket.localeCompare(b.timeBucket);
    return a.zone.localeCompare(b.zone);
  });
  return rows;
}

function topZones(rows, topN) {
  const zoneAgg = new Map();
  for (const row of rows) {
    const entry = zoneAgg.get(row.zone) ?? { zone: row.zone, trips: 0, metricSum: 0 };
    entry.trips += row.tripCount;
    entry.metricSum += row.metricValue * row.tripCount;
    zoneAgg.set(row.zone, entry);
  }
  const ranked = Array.from(zoneAgg.values())
    .map((entry) => ({
      zone: entry.zone,
      trips: entry.trips,
      metricValue: entry.trips > 0 ? entry.metricSum / entry.trips : 0,
    }))
    .sort((a, b) => {
      if (b.metricValue !== a.metricValue) return b.metricValue - a.metricValue;
      return b.trips - a.trips;
    });
  return ranked.slice(0, topN).map((row) => row.zone);
}

function overlapCount(listA, listB) {
  const setB = new Set(listB);
  return listA.filter((item) => setB.has(item)).length;
}

function computeSummary(comparisonRows, highOnlyRows, highPlusMediumRows) {
  const total = comparisonRows.length || 1;
  const unchanged = comparisonRows.filter(
    (row) => row.tripCountDelta === 0 && (row.metricAbsoluteDelta === 0 || Object.is(row.metricAbsoluteDelta, -0)) && row.rankChange === 0,
  ).length;
  const low = comparisonRows.filter((row) => row.stabilityLabel === "low").length;
  const moderate = comparisonRows.filter((row) => row.stabilityLabel === "moderate").length;
  const high = comparisonRows.filter((row) => row.stabilityLabel === "high").length;
  const top5High = topZones(highOnlyRows, 5);
  const top10High = topZones(highOnlyRows, 10);
  const top5Hpm = topZones(highPlusMediumRows, 5);
  const top10Hpm = topZones(highPlusMediumRows, 10);
  return {
    bucketsTotal: comparisonRows.length,
    percentBucketsUnchanged: (unchanged / total) * 100,
    percentLowDifference: (low / total) * 100,
    percentModerateDifference: (moderate / total) * 100,
    percentHighDifference: (high / total) * 100,
    top5OverlapCount: overlapCount(top5High, top5Hpm),
    top10OverlapCount: overlapCount(top10High, top10Hpm),
    top5HighOnly: top5High,
    top5HighPlusMedium: top5Hpm,
    top10HighOnly: top10High,
    top10HighPlusMedium: top10Hpm,
  };
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function main() {
  const defaultInput = path.join(
    __dirname,
    "uploads",
    "experiments",
    "trip_first",
    "timeline_trip_match_120s.csv",
  );
  const inputPath = getArg("input", defaultInput);
  const outDir = getArg(
    "outDir",
    path.join(__dirname, "uploads", "experiments", "trip_first"),
  );
  fs.mkdirSync(outDir, { recursive: true });

  const parsed = parseCsvText(fs.readFileSync(inputPath, "utf8"));
  const fullMatched = parsed.rows.filter((row) => {
    const beginMatched = String(row.beginMatched || "").toLowerCase() === "true";
    const dropoffMatched = String(row.dropoffMatched || "").toLowerCase() === "true";
    return beginMatched && dropoffMatched;
  });
  const highOnly = buildHeatmapRows(fullMatched, (row) => confidenceBand(row) === "high");
  const highPlusMedium = buildHeatmapRows(fullMatched, (row) => {
    const band = confidenceBand(row);
    return band === "high" || band === "medium";
  });
  const mediumOnly = buildHeatmapRows(fullMatched, (row) => confidenceBand(row) === "medium");

  const comparison = buildComparison(highOnly, highPlusMedium);
  const mediumVsHighPlusComparison = buildComparison(mediumOnly, highPlusMedium);
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceCsv: inputPath,
    heatmapDefinition: {
      zone: "beginAreaLabel fallback to request/dropoff area, else rounded lat/lng grid",
      timeBucket: "UTC day-of-week + hour from beginTripTimestampLocal",
      metric: "average originalFareLocal (GBP) per zone/time bucket",
      rank: "descending metric within each time bucket",
    },
    datasetTripCounts: {
      matchedRowsConsidered: fullMatched.length,
      highOnly: fullMatched.filter((row) => confidenceBand(row) === "high").length,
      highPlusMedium: fullMatched.filter((row) => {
        const band = confidenceBand(row);
        return band === "high" || band === "medium";
      }).length,
      mediumOnly: fullMatched.filter((row) => confidenceBand(row) === "medium").length,
    },
    comparisonSummary: computeSummary(comparison, highOnly, highPlusMedium),
    mediumVsHighPlusSummary: computeSummary(mediumVsHighPlusComparison, mediumOnly, highPlusMedium),
  };

  const files = {
    highOnly: path.join(outDir, "heatmap_high_only.csv"),
    highPlusMedium: path.join(outDir, "heatmap_high_plus_medium.csv"),
    mediumOnly: path.join(outDir, "heatmap_medium_only.csv"),
    comparison: path.join(outDir, "heatmap_confidence_comparison.csv"),
    mediumVsHighPlusComparison: path.join(outDir, "heatmap_medium_vs_highplus_comparison.csv"),
    summary: path.join(outDir, "heatmap_confidence_summary.json"),
    mediumVsHighPlusSummary: path.join(outDir, "heatmap_medium_vs_highplus_summary.json"),
  };

  writeCsv(files.highOnly, highOnly, [
    "zone",
    "timeBucket",
    "tripCount",
    "metricValue",
    "rankWithinTimeBucket",
  ]);
  writeCsv(files.highPlusMedium, highPlusMedium, [
    "zone",
    "timeBucket",
    "tripCount",
    "metricValue",
    "rankWithinTimeBucket",
  ]);
  writeCsv(files.mediumOnly, mediumOnly, [
    "zone",
    "timeBucket",
    "tripCount",
    "metricValue",
    "rankWithinTimeBucket",
  ]);
  writeCsv(files.comparison, comparison, [
    "zone",
    "timeBucket",
    "highOnlyTripCount",
    "highPlusMediumTripCount",
    "tripCountDelta",
    "highOnlyMetricValue",
    "highPlusMediumMetricValue",
    "metricAbsoluteDelta",
    "metricPercentageDelta",
    "highOnlyRank",
    "highPlusMediumRank",
    "rankChange",
    "stabilityLabel",
  ]);
  writeCsv(files.mediumVsHighPlusComparison, mediumVsHighPlusComparison, [
    "zone",
    "timeBucket",
    "highOnlyTripCount",
    "highPlusMediumTripCount",
    "tripCountDelta",
    "highOnlyMetricValue",
    "highPlusMediumMetricValue",
    "metricAbsoluteDelta",
    "metricPercentageDelta",
    "highOnlyRank",
    "highPlusMediumRank",
    "rankChange",
    "stabilityLabel",
  ]);
  fs.writeFileSync(files.summary, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    files.mediumVsHighPlusSummary,
    `${JSON.stringify(
      {
        generatedAt: summary.generatedAt,
        sourceCsv: summary.sourceCsv,
        heatmapDefinition: summary.heatmapDefinition,
        datasetTripCounts: {
          mediumOnly: summary.datasetTripCounts.mediumOnly,
          highPlusMedium: summary.datasetTripCounts.highPlusMedium,
        },
        comparisonSummary: summary.mediumVsHighPlusSummary,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(JSON.stringify({ files, summary }, null, 2));
}

main();
