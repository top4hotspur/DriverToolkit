const { createWorker } = require("tesseract.js");
const Jimp = require("jimp");

const MONTHS = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
const WEEKDAYS = [
  { key:1, labels:["mon","monday","m"] },
  { key:2, labels:["tue","tues","tuesday","tu"] },
  { key:3, labels:["wed","wednesday","w"] },
  { key:4, labels:["thu","thurs","thursday","th"] },
  { key:5, labels:["fri","friday","f"] },
  { key:6, labels:["sat","saturday","sa"] },
  { key:0, labels:["sun","sunday","su"] },
];

function createEarningsOcrService() {
  async function parseScreenshots(input) {
    const requestId = String(input?.requestId ?? "unknown");
    const debugMode = String(input?.debugMode ?? "").trim().toLowerCase();
    const files = Array.isArray(input?.screenshots) ? input.screenshots : [];
    const out = [];
    for (const file of files) {
      const fileStartedAtMs = Date.now();
      const fileName = String(file?.fileName ?? "unknown_file");
      const binaryBuffer = Buffer.isBuffer(file?.binaryBuffer) ? file.binaryBuffer : null;
      const rawBase64Data = binaryBuffer ? "" : String(file?.base64Data ?? "");
      const base64Data = binaryBuffer ? "" : normalizeBase64Payload(rawBase64Data);
      const payloadBytes = binaryBuffer ? binaryBuffer.length : estimateBase64Bytes(base64Data);
      const payloadPrefix = binaryBuffer
        ? binaryBuffer.toString("base64", 0, Math.min(binaryBuffer.length, 16)).slice(0, 24)
        : base64Data.slice(0, 24);
      const hintedPlatform = normalizePlatform(file?.platformHint);
      let fallbackParseMethod = "tesseract_ocr";
      let parseError = null;
      let ocr = { text: "", words: [], imageBuffer: null };
      let stageDurations = {
        decodeDurationMs: null,
        ocrDurationMs: null,
      };
      try {
        console.log(
          `[EARNINGS][route] requestId=${requestId} payload-ok ts=${new Date().toISOString()} file=${fileName} mimeType=${String(file?.mimeType ?? "unknown")} payloadBytes=${payloadBytes} payloadPrefix=${payloadPrefix} transport=${
            binaryBuffer ? "multipart_binary" : "json_base64"
          }`,
        );
        if ((!binaryBuffer && !base64Data) || payloadBytes <= 0) throw new Error("upload_payload_missing");
        const decodeStartedAt = Date.now();
        console.log(
          `[EARNINGS][route] requestId=${requestId} image-decode-start ts=${new Date().toISOString()} file=${fileName}`,
        );
        const decodedBuffer = await decodeImageBuffer(
          {
            base64Data: binaryBuffer ? null : base64Data,
            binaryBuffer,
          },
          fileName,
          requestId,
        );
        stageDurations.decodeDurationMs = Date.now() - decodeStartedAt;
        console.log(
          `[EARNINGS][route] requestId=${requestId} image-decode-finish ts=${new Date().toISOString()} file=${fileName} durationMs=${stageDurations.decodeDurationMs}`,
        );
        if (debugMode === "decode_only") {
          console.log(
            `[EARNINGS][route] requestId=${requestId} decode-only-respond ts=${new Date().toISOString()} file=${fileName}`,
          );
          ocr = {
            text: "",
            words: [],
            imageBuffer: decodedBuffer,
          };
        } else {
          const ocrStartedAt = Date.now();
          ocr = await runOcrOnDecodedBuffer(decodedBuffer, fileName, requestId);
          stageDurations.ocrDurationMs = Date.now() - ocrStartedAt;
          console.log(
            `[EARNINGS][route] requestId=${requestId} ocr-finish ts=${new Date().toISOString()} file=${fileName} durationMs=${stageDurations.ocrDurationMs}`,
          );
        }
      } catch (error) {
        parseError = error instanceof Error ? error.message : "ocr_failed";
        fallbackParseMethod =
          parseError === "upload_payload_missing"
            ? "upload_payload_missing"
            : parseError === "image_read_failed" || parseError === "image_decode_failed"
              ? "image_decode_failed"
              : parseError === "image_payload_invalid"
                ? "image_payload_invalid"
                : parseError === "body_parse_truncated"
                  ? "body_parse_truncated"
              : "ocr_failed_fallback";
        console.log(
          `[EARNINGS][route] requestId=${requestId} image-decode-fail ts=${new Date().toISOString()} file=${fileName} reason=${parseError} fallbackParseMethod=${fallbackParseMethod} payloadBytes=${payloadBytes}`,
        );
      }

      const detection = detectPlatform(ocr.text, fileName, hintedPlatform);
      let extraction = await extractRows({
        text: ocr.text,
        words: ocr.words,
        imageBuffer: ocr.imageBuffer,
        fileName,
        detectedPlatform: detection.platform,
      });
      if (debugMode === "decode_only" && !parseError) {
        extraction = {
          parseMethod: "debug_decode_only",
          detectedPeriodStart: null,
          detectedPeriodEnd: null,
          detectedTotal: null,
          detectedWeeklyTotal: null,
          barsDetectedCount: 0,
          daysMappedCount: 0,
          visualDetectionUsed: false,
          fallbackReason: null,
          rows: [
            {
              platform: detection.platform === "unknown" ? "uber" : detection.platform,
              earningDate: new Date().toISOString().slice(0, 10),
              amount: 0,
              currency: "GBP",
              parseStatus: "manual_review",
              parseConfidence: 0.6,
              parseMethod: "debug_decode_only",
              valueSourceType: "missing",
              extractionNotes:
                "Debug decode-only mode: image decode succeeded and request returned before OCR.",
            },
          ],
        };
      }
      if (parseError && extraction?.parseMethod === "manual_fallback") {
        extraction = {
          ...extraction,
          parseMethod: fallbackParseMethod,
          rows: Array.isArray(extraction.rows)
            ? extraction.rows.map((row) => ({
                ...row,
                parseMethod: fallbackParseMethod,
                parseStatus: "manual_review",
                parseConfidence: 0.3,
                valueSourceType: "missing",
                extractionNotes: `OCR did not run with real image content (${fallbackParseMethod}).`,
              }))
            : extraction.rows,
        };
      }

      const summary = buildParsedFileSummary({ fileName, detection, extraction, fallbackParseMethod });
      console.log(
        `[EARNINGS][ocr] requestId=${requestId} file=${fileName} detectedPlatform=${summary.detectedPlatform} rowsExtractedCount=${summary.rowsExtractedCount} method=${summary.parseMethod} batchConfidence=${summary.batchConfidence} decodeDurationMs=${
          stageDurations.decodeDurationMs ?? "n/a"
        } ocrDurationMs=${stageDurations.ocrDurationMs ?? "n/a"} fileTotalDurationMs=${
          Date.now() - fileStartedAtMs
        }`,
      );
      out.push({ parseError, stageDurations, ...summary });
    }
    return { ok: true, files: out };
  }
  return { parseScreenshots };
}

function estimateBase64Bytes(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return 0;
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

async function decodeImageBuffer(source, fileName = "unknown_file", requestId = "unknown") {
  let imageBuffer = Buffer.isBuffer(source?.binaryBuffer) ? source.binaryBuffer : null;
  if (!imageBuffer) {
    const base64Data = String(source?.base64Data ?? "");
    try {
      imageBuffer = Buffer.from(base64Data, "base64");
    } catch (error) {
      console.log(
        `[EARNINGS][route] requestId=${requestId} image-decode-fail file=${fileName} reason=buffer_decode_error error=${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      throw new Error("image_payload_invalid");
    }
  }
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error("image_payload_invalid");
  }
  let decodedBuffer = imageBuffer;
  try {
    // Decode with Jimp first so Android screenshots with quirks can be normalized before OCR.
    const decoded = await Jimp.read(imageBuffer);
    decodedBuffer = await decoded.getBufferAsync(Jimp.MIME_PNG);
  } catch (error) {
    console.log(
      `[EARNINGS][route] requestId=${requestId} image-decode-fail file=${fileName} reason=jimp_decode_failed error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    throw new Error("image_decode_failed");
  }
  return decodedBuffer;
}

async function runOcrOnDecodedBuffer(decodedBuffer, fileName = "unknown_file", requestId = "unknown") {
  const worker = await createWorker("eng");
  try {
    console.log(
      `[EARNINGS][route] requestId=${requestId} ocr-start ts=${new Date().toISOString()} file=${fileName}`,
    );
    const result = await worker.recognize(decodedBuffer);
    console.log(
      `[EARNINGS][route] requestId=${requestId} ocr-ok ts=${new Date().toISOString()} file=${fileName}`,
    );
    const text = sanitizeText(String(result?.data?.text ?? ""));
    const words = Array.isArray(result?.data?.words)
      ? result.data.words.map((word) => ({
          text: sanitizeText(String(word?.text ?? "")),
          x0: Number(word?.bbox?.x0 ?? NaN),
          y0: Number(word?.bbox?.y0 ?? NaN),
          x1: Number(word?.bbox?.x1 ?? NaN),
          y1: Number(word?.bbox?.y1 ?? NaN),
        }))
      : [];
    return { text, words, imageBuffer: decodedBuffer };
  } catch (error) {
    console.log(
      `[EARNINGS][route] requestId=${requestId} ocr-fail file=${fileName} reason=${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    throw new Error("ocr_failed_fallback");
  } finally {
    await worker.terminate();
  }
}

function normalizeBase64Payload(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const withoutDataPrefix = raw.replace(/^data:[^;]+;base64,/, "");
  return withoutDataPrefix.replace(/\s+/g, "");
}

function detectPlatform(text, fileName, hintedPlatform) {
  const haystack = `${String(text ?? "").toLowerCase()}\n${String(fileName ?? "").toLowerCase()}`;
  const score = { uber: 0, lyft: 0, bolt: 0 };
  bumpScore(score, "uber", haystack, ["uber", "uber driver", "wallet", "this week"], 2);
  bumpScore(score, "lyft", haystack, ["lyft", "lyft driver", "weekly summary"], 2);
  bumpScore(score, "bolt", haystack, ["bolt", "bolt driver", "taxify"], 2);
  if (hintedPlatform && score[hintedPlatform] === 0) score[hintedPlatform] = 1;
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] <= 0) return { platform: hintedPlatform ?? "unknown", confidence: 0.4 };
  return { platform: best[0], confidence: Math.min(0.95, 0.45 + best[1] * 0.12) };
}

async function extractRows(args) {
  const explicit = extractExplicitRows(args);
  const preferChart = args.detectedPlatform === "uber" && shouldPreferChart(args.text, explicit.rows);
  if (preferChart) {
    const chart = await extractUberWeeklyChartRows(args);
    if (chart.rows.length > 0) return chart;
    return {
      parseMethod: "manual_fallback",
      detectedPeriodStart: chart.detectedPeriodStart ?? null,
      detectedPeriodEnd: chart.detectedPeriodEnd ?? null,
      detectedTotal: chart.detectedTotal ?? null,
      detectedWeeklyTotal: chart.detectedWeeklyTotal ?? null,
      barsDetectedCount: chart.barsDetectedCount ?? 0,
      daysMappedCount: chart.daysMappedCount ?? 0,
      visualDetectionUsed: Boolean(chart.visualDetectionUsed),
      fallbackReason: chart.fallbackReason ?? "unsupported_layout",
      rows: [
        {
          platform: args.detectedPlatform === "unknown" ? "uber" : args.detectedPlatform,
          earningDate: new Date().toISOString().slice(0, 10),
          amount: 0,
          currency: "GBP",
          parseStatus: "manual_review",
          parseConfidence: 0.3,
          parseMethod: "manual_fallback",
          valueSourceType: "missing",
          extractionNotes: `Could not parse supported Uber weekly layout (${chart.fallbackReason ?? "unsupported_layout"}). Manual review required.`,
        },
      ],
    };
  }
  if (explicit.rows.length > 0) return explicit;

  if (args.detectedPlatform === "uber") {
    const chart = await extractUberWeeklyChartRows(args);
    if (chart.rows.length > 0) return chart;
  }

  const maxAmount = extractMaxAmount(args.text);
  const allDates = extractAllDates(args.text);
  if (maxAmount && allDates.length > 0) {
    const pickDate = allDates[allDates.length - 1];
    return {
      parseMethod: "summary_fallback",
      detectedPeriodStart: null,
      detectedPeriodEnd: null,
      detectedTotal: maxAmount.value,
      detectedWeeklyTotal: maxAmount.value,
      barsDetectedCount: 0,
      daysMappedCount: 1,
      visualDetectionUsed: false,
      rows: [buildRow(args.detectedPlatform, pickDate, maxAmount, "summary_fallback", { notePrefix: "Fallback extraction from summary screenshot." })],
    };
  }

  return {
    parseMethod: "manual_fallback",
    detectedPeriodStart: null,
    detectedPeriodEnd: null,
    detectedTotal: null,
    detectedWeeklyTotal: null,
    barsDetectedCount: 0,
    daysMappedCount: 0,
    visualDetectionUsed: false,
    fallbackReason: "unsupported_layout",
    rows: [{
      platform: args.detectedPlatform === "unknown" ? "uber" : args.detectedPlatform,
      earningDate: new Date().toISOString().slice(0,10),
      amount: 0,
      currency: "GBP",
      parseStatus: "manual_review",
      parseConfidence: 0.3,
      parseMethod: "manual_fallback",
      valueSourceType: "missing",
      extractionNotes: "No reliable extraction. Manual review required.",
    }],
  };
}
function extractExplicitRows(args) {
  const lines = String(args.text ?? "").split(/\r?\n/).map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const date = extractDate(lines[i]);
    const amount = extractAmount(lines[i]);
    if (date && amount) {
      rows.push(buildRow(args.detectedPlatform, date, amount, "exact_text"));
      continue;
    }
    if (date && i + 1 < lines.length) {
      const nextAmount = extractAmount(lines[i + 1]);
      if (nextAmount) {
        rows.push(buildRow(args.detectedPlatform, date, nextAmount, "line_plus_next_amount"));
        i += 1;
      }
    }
  }
  return {
    parseMethod: rows.length > 0 ? "exact_text" : "none",
    detectedPeriodStart: null,
    detectedPeriodEnd: null,
    detectedTotal: null,
    detectedWeeklyTotal: null,
    barsDetectedCount: 0,
    daysMappedCount: rows.length,
    visualDetectionUsed: false,
    fallbackReason: null,
    rows: dedupeRows(rows),
  };
}

function shouldPreferChart(text, explicitRows) {
  const hasWeeklyContext = /(this week|weekly|earnings chart|earnings trend)/i.test(sanitizeText(String(text ?? "")));
  const hasPeriod = detectPeriodRange(text) != null;
  const hasTotal = detectTotalAmount(text) != null;
  return hasWeeklyContext && hasPeriod && hasTotal && explicitRows.length <= 2;
}

async function extractUberWeeklyChartRows(args) {
  const period = detectPeriodRange(args.text);
  const total = detectTotalAmount(args.text);
  const dayLabels = detectTextFallbackSignals(args.words, args.text);
  if (!period || !total) {
    return {
      parseMethod: "none",
      detectedPeriodStart: period?.startDate ?? null,
      detectedPeriodEnd: period?.endDate ?? null,
      detectedTotal: total?.value ?? null,
      detectedWeeklyTotal: total?.value ?? null,
      barsDetectedCount: 0,
      daysMappedCount: 0,
      visualDetectionUsed: false,
      fallbackReason: !period ? "missing_period" : "missing_total",
      rows: [],
    };
  }
  const visual = await detectVisualBars({ imageBuffer: args.imageBuffer, words: args.words, period });
  let signals = visual.daySignals;
  if (!signals.length) signals = dayLabels;
  const plannedDates = derivePlannedWeekDates(period.startDate, period.endDate);
  if (!plannedDates.length) {
    return {
      parseMethod: "none",
      detectedPeriodStart: period.startDate,
      detectedPeriodEnd: period.endDate,
      detectedTotal: total.value,
      detectedWeeklyTotal: total.value,
      barsDetectedCount: visual.barsDetectedCount,
      daysMappedCount: 0,
      visualDetectionUsed: visual.visualDetectionUsed,
      visualDiagnostics: visual.diagnostics,
      fallbackReason: "missing_period",
      rows: [],
    };
  }
  if (!signals.length) {
    return {
      parseMethod: "none",
      detectedPeriodStart: period.startDate,
      detectedPeriodEnd: period.endDate,
      detectedTotal: total.value,
      detectedWeeklyTotal: total.value,
      barsDetectedCount: visual.barsDetectedCount,
      daysMappedCount: 0,
      visualDetectionUsed: visual.visualDetectionUsed,
      visualDiagnostics: visual.diagnostics,
      fallbackReason: "missing_day_labels",
      rows: [],
    };
  }
  const mappedByDate = mapSignalsByDate(signals, plannedDates, period.startDate, period.endDate);
  const mergedSignals = plannedDates.map((date) => {
    const mapped = mappedByDate.get(date);
    return {
      date,
      weekdayKey: weekdayFromIso(date),
      weight: mapped ? Math.max(0, Number(mapped.weight) || 0) : 0,
      referenceUsed: Boolean(mapped?.referenceUsed),
      alignmentConfidence: mapped?.alignmentConfidence ?? null,
    };
  });
  const safeSignals = sanitizeWeights(mergedSignals, total.value);
  if (!safeSignals.some((s) => s.weight > 0)) {
    return {
      parseMethod: "none",
      detectedPeriodStart: period.startDate,
      detectedPeriodEnd: period.endDate,
      detectedTotal: total.value,
      detectedWeeklyTotal: total.value,
      barsDetectedCount: visual.barsDetectedCount,
      daysMappedCount: 0,
      visualDetectionUsed: visual.visualDetectionUsed,
      visualDiagnostics: visual.diagnostics,
      fallbackReason: "missing_bars",
      rows: [],
    };
  }

  const method = visual.visualDetectionUsed ? "visual_estimate_from_total" : "chart_estimate_from_total";
  const allocated = allocateByWeight(safeSignals, total.value);
  const rows = allocated.map((entry) => buildRow(args.detectedPlatform, entry.date, { value: entry.amount, currency: total.currency }, method, {
    confidenceOverride: visual.visualDetectionUsed ? 0.78 : 0.7,
    notePrefix: visual.visualDetectionUsed
      ? `Estimated from weekly chart bars. bars=${visual.barsDetectedCount}, mappedDays=${visual.daysMappedCount}.`
      : `Estimated from fallback chart structure. bars=${visual.barsDetectedCount}, mappedDays=${visual.daysMappedCount}.`,
  }));

  return {
    parseMethod: method,
    detectedPeriodStart: period.startDate,
    detectedPeriodEnd: period.endDate,
    detectedTotal: total.value,
    detectedWeeklyTotal: total.value,
    barsDetectedCount: visual.barsDetectedCount,
    daysMappedCount: visual.daysMappedCount,
    visualDetectionUsed: visual.visualDetectionUsed,
    visualDiagnostics: visual.diagnostics,
    fallbackReason: null,
    rows: dedupeRows(rows),
  };
}

async function detectVisualBars(args) {
  const empty = { daySignals: [], barsDetectedCount: 0, daysMappedCount: 0, visualDetectionUsed: false, diagnostics: { reason: "visual_unavailable" } };
  if (!args.imageBuffer || !Array.isArray(args.words) || args.words.length < 4) return empty;

  const anchors = detectWordAnchors(args.words);
  if (anchors.length < 3) return { ...empty, diagnostics: { reason: "insufficient_anchors", anchorCount: anchors.length } };

  let image;
  try {
    image = await Jimp.read(args.imageBuffer);
  } catch {
    return { ...empty, diagnostics: { reason: "image_read_failed" } };
  }

  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const sorted = [...anchors].sort((a, b) => a.centerX - b.centerX);
  const spacing = medianDiff(sorted.map((a) => a.centerX)) || Math.max(24, width / 8);
  const minX = clamp(Math.floor(sorted[0].centerX - spacing * 0.6), 0, width - 1);
  const maxX = clamp(Math.ceil(sorted[sorted.length - 1].centerX + spacing * 0.6), 0, width - 1);
  const labelY = median(sorted.map((a) => a.centerY));
  const chartBottom = clamp(Math.floor(labelY - 6), 20, height - 1);
  const chartTop = clamp(Math.floor(chartBottom - Math.max(80, height * 0.42)), 0, chartBottom - 20);

  const bgLuma = estimateBgLuma(image, minX, maxX, chartTop, Math.min(chartTop + 12, chartBottom));
  const xScores = [];
  for (let x = minX; x <= maxX; x += 1) {
    let active = 0;
    let topY = null;
    for (let y = chartTop; y <= chartBottom; y += 1) {
      const rgba = Jimp.intToRGBA(image.getPixelColor(x, y));
      const luma = 0.2126 * rgba.r + 0.7152 * rgba.g + 0.0722 * rgba.b;
      const sat = saturation(rgba);
      const score = Math.abs(luma - bgLuma) + sat * 85;
      if (score >= 30) {
        active += 1;
        if (topY == null) topY = y;
      }
    }
    xScores.push({ x, active, topY });
  }

  const smooth = smoothScores(xScores, 2);
  const threshold = Math.max(6, percentile(smooth.map((s) => s.active), 0.5) * 1.35);
  const segments = collectSegments(smooth, threshold);
  const bars = segments.map((s) => {
    const widthPx = s.endX - s.startX + 1;
    if (widthPx < 3) return null;
    const centerX = (s.startX + s.endX) / 2;
    const topY = s.topY == null ? chartBottom : s.topY;
    return { centerX, height: Math.max(1, chartBottom - topY + 1), width: widthPx };
  }).filter(Boolean);
  if (!bars.length) return { ...empty, diagnostics: { reason: "no_bars_detected", anchorCount: anchors.length, chartTop, chartBottom } };

  const datedAnchors = attachDates(anchors, args.period.startDate, args.period.endDate);
  const mapped = [];
  for (const anchor of datedAnchors) {
    const nearest = bars.map((bar) => ({ bar, dx: Math.abs(bar.centerX - anchor.centerX) })).sort((a, b) => a.dx - b.dx)[0];
    if (!nearest) continue;
    if (nearest.dx > Math.max(35, spacing * 0.9)) continue;
    mapped.push({ date: anchor.date, weight: nearest.bar.height, weekdayKey: anchor.weekdayKey, referenceUsed: true, alignmentConfidence: Math.max(0, 1 - nearest.dx / Math.max(20, spacing * 0.9)) });
  }
  const dedup = new Map();
  for (const row of mapped) {
    const current = dedup.get(row.date);
    if (!current || row.weight > current.weight) dedup.set(row.date, row);
  }
  const daySignals = Array.from(dedup.values());

  return {
    daySignals,
    barsDetectedCount: bars.length,
    daysMappedCount: daySignals.length,
    visualDetectionUsed: daySignals.length >= 3,
    diagnostics: {
      reason: "ok",
      barsDetectedCount: bars.length,
      daysMappedCount: daySignals.length,
      anchorCount: anchors.length,
      chartTop,
      chartBottom,
      chartMinX: minX,
      chartMaxX: maxX,
      threshold: round2(threshold),
    },
  };
}
function detectWordAnchors(words) {
  const out = [];
  for (const word of words) {
    const token = normalizeToken(word.text);
    const weekdayKey = resolveWeekday(token);
    if (weekdayKey == null) continue;
    const centerX = isFiniteNumber(word.x0) && isFiniteNumber(word.x1) ? (word.x0 + word.x1) / 2 : null;
    const centerY = isFiniteNumber(word.y0) && isFiniteNumber(word.y1) ? (word.y0 + word.y1) / 2 : null;
    if (centerX == null || centerY == null) continue;
    out.push({ weekdayKey, centerX, centerY });
  }
  const byDay = new Map();
  for (const row of out) {
    const current = byDay.get(row.weekdayKey);
    if (!current || row.centerY > current.centerY) byDay.set(row.weekdayKey, row);
  }
  return Array.from(byDay.values());
}

function detectTextFallbackSignals(words, text) {
  const anchors = detectWordAnchors(words);
  if (!anchors.length) {
    return detectTextDayLabels(text).map((d) => ({ weekdayKey: d.weekdayKey, weight: 1, referenceUsed: false }));
  }
  return anchors.map((a) => ({ weekdayKey: a.weekdayKey, weight: 1, referenceUsed: false }));
}

function detectTextDayLabels(text) {
  const normalized = sanitizeText(String(text ?? "")).toLowerCase();
  const out = [];
  for (const alias of WEEKDAYS) {
    if (alias.labels.some((label) => new RegExp(`\\b${escapeRegExp(label)}\\b`, "i").test(normalized))) {
      out.push({ weekdayKey: alias.key });
    }
  }
  return out;
}

function attachDates(signals, startDate, endDate) {
  const dates = enumerateDates(startDate, endDate);
  const byWeekday = new Map();
  for (const date of dates) {
    const weekday = weekdayFromIso(date);
    const list = byWeekday.get(weekday) ?? [];
    list.push(date);
    byWeekday.set(weekday, list);
  }
  return signals.map((signal) => {
    if (signal.date) return signal;
    const choices = byWeekday.get(signal.weekdayKey) ?? [];
    return { ...signal, date: choices[0] ?? dates[0] };
  });
}

function derivePlannedWeekDates(startDate, endDate) {
  const normalizedStart = normalizeIsoDate(startDate);
  const normalizedEnd = normalizeIsoDate(endDate);
  if (!normalizedStart || !normalizedEnd) {
    return [];
  }
  const diffDays = diffInDays(normalizedStart, normalizedEnd);
  if (!Number.isFinite(diffDays) || diffDays < 0) {
    return [];
  }
  let effectiveEnd = normalizedEnd;
  // Uber weekly headers frequently render as start -> next-week same-day.
  // Treat a 7-day delta as an exclusive end so we still generate 7 daily rows.
  if (diffDays === 7) {
    effectiveEnd = shiftDays(normalizedEnd, -1);
  }
  const dates = enumerateDates(normalizedStart, effectiveEnd);
  if (dates.length > 8) {
    return dates.slice(0, 7);
  }
  return dates;
}

function mapSignalsByDate(signals, plannedDates, periodStart, periodEnd) {
  const datedSignals = attachDates(signals, periodStart, periodEnd);
  const used = new Set();
  const out = new Map();

  // Pass 1: direct date matches for planned dates.
  for (const signal of datedSignals) {
    const date = normalizeIsoDate(signal.date);
    if (!date || !plannedDates.includes(date)) {
      continue;
    }
    if (used.has(date)) {
      const current = out.get(date);
      if ((Number(signal.weight) || 0) > (Number(current?.weight) || 0)) {
        out.set(date, signal);
      }
      continue;
    }
    out.set(date, signal);
    used.add(date);
  }

  // Pass 2: weekday-based mapping for any remaining signals.
  for (const signal of datedSignals) {
    const wk = Number(signal.weekdayKey);
    if (!Number.isFinite(wk)) {
      continue;
    }
    const candidate = plannedDates.find((date) => weekdayFromIso(date) === wk && !used.has(date));
    if (!candidate) {
      continue;
    }
    out.set(candidate, { ...signal, date: candidate });
    used.add(candidate);
  }

  return out;
}

function sanitizeWeights(signals, total) {
  if (!signals.length) return [];
  const values = signals.map((s) => Math.max(0, Number(s.weight) || 0));
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const safeTotal = Number(total) || 0;
  if ((safeTotal > 0 && max >= safeTotal * 0.8) || (avg > 0 && max / avg >= 4)) {
    return signals.map((s) => ({ ...s, weight: 1, referenceUsed: false }));
  }
  return signals;
}

function allocateByWeight(signals, total) {
  const safeTotal = Math.max(0, round2(Number(total) || 0));
  const totalWeight = signals.reduce((sum, signal) => sum + Math.max(0, signal.weight), 0);
  if (safeTotal <= 0 || totalWeight <= 0) return signals.map((signal) => ({ date: signal.date, amount: 0 }));

  const precise = signals.map((signal) => ({ date: signal.date, amount: (safeTotal * Math.max(0, signal.weight)) / totalWeight }));
  const rounded = precise.map((row) => ({ date: row.date, amount: Math.floor(row.amount * 100) / 100, remainder: row.amount - Math.floor(row.amount * 100) / 100 }));
  const base = round2(rounded.reduce((sum, row) => sum + row.amount, 0));
  let cents = Math.round((safeTotal - base) * 100);
  rounded.sort((a, b) => b.remainder - a.remainder);
  let idx = 0;
  while (cents > 0 && rounded.length > 0) {
    rounded[idx % rounded.length].amount = round2(rounded[idx % rounded.length].amount + 0.01);
    cents -= 1;
    idx += 1;
  }
  return rounded.map((row) => ({ date: row.date, amount: round2(row.amount) }));
}

function detectPeriodRange(text) {
  const normalized = sanitizeText(String(text ?? ""));
  const yearNow = new Date().getUTCFullYear();
  const patterns = [
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\s*(?:-|–|to)\s*(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(20\d{2}))?/i,
    /\b([A-Za-z]{3,9})\s+(\d{1,2})\s*(?:-|–|to)\s*([A-Za-z]{3,9})\s+(\d{1,2})(?:\s+(20\d{2}))?/i,
  ];
  let match = null;
  let format = "dmy";
  for (const pattern of patterns) {
    const found = normalized.match(pattern);
    if (found) {
      match = found;
      format = pattern === patterns[1] ? "mdy_words" : "dmy";
      break;
    }
  }
  if (!match) return null;
  const startDay = Number(format === "dmy" ? match[1] : match[2]);
  const startMonth = MONTHS[String(format === "dmy" ? match[2] : match[1] ?? "").toLowerCase()];
  const endDay = Number(format === "dmy" ? match[3] : match[4]);
  const endMonth = MONTHS[String(format === "dmy" ? match[4] : match[3] ?? "").toLowerCase()];
  const year = match[5] ? Number(match[5]) : yearNow;
  if (!startMonth || !endMonth) return null;
  let startDate = isoDate(year, startMonth, startDay);
  let endDate = isoDate(year, endMonth, endDay);
  if (startDate > endDate) {
    startDate = match[5] ? startDate : isoDate(year - 1, startMonth, startDay);
    endDate = match[5] ? isoDate(year + 1, endMonth, endDay) : endDate;
  }
  return { startDate, endDate };
}

function detectTotalAmount(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => sanitizeText(line).trim()).filter(Boolean);
  for (const line of lines) {
    if (!/(total|earnings|this week|weekly)/i.test(line)) continue;
    const amount = extractAmount(line);
    if (amount && amount.value > 10) return amount;
  }
  const candidates = extractAmountCandidates(text).filter((entry) => entry.value > 10);
  return candidates.length > 0 ? candidates.sort((a, b) => b.value - a.value)[0] : null;
}

function extractAmount(input) {
  const found = extractAmountCandidates(input);
  return found.length > 0 ? found[found.length - 1] : null;
}

function extractAmountCandidates(input) {
  const text = sanitizeText(String(input ?? ""));
  const re = /(\u00A3|\$|\u20AC)?\s?(\d{1,3}(?:[,\s.]\d{3})+(?:[.,]\d{2})|\d{1,5}(?:[.,]\d{2}))/g;
  let match;
  const out = [];
  while ((match = re.exec(text)) !== null) {
    const value = parseMoney(match[2]);
    if (!Number.isFinite(value) || value <= 0 || value > 20000) continue;
    out.push({ value: round2(value), currency: symbolToCurrency(match[1]) });
  }
  return out;
}

function extractMaxAmount(input) {
  const candidates = extractAmountCandidates(input);
  return candidates.length ? candidates.sort((a, b) => b.value - a.value)[0] : null;
}

function extractDate(input) {
  const text = sanitizeText(String(input ?? ""));
  const iso = text.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (dmy) {
    const year = dmy[3] ? Number(dmy[3]) : new Date().getUTCFullYear();
    return `${year}-${String(clamp(Number(dmy[2]), 1, 12)).padStart(2, "0")}-${String(clamp(Number(dmy[1]), 1, 31)).padStart(2, "0")}`;
  }
  const named = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(20\d{2}))?\b/);
  if (named) {
    const month = MONTHS[String(named[2] ?? "").toLowerCase()];
    if (!month) return null;
    const year = named[3] ? Number(named[3]) : new Date().getUTCFullYear();
    return `${year}-${String(month).padStart(2, "0")}-${String(clamp(Number(named[1]), 1, 31)).padStart(2, "0")}`;
  }
  return null;
}

function extractAllDates(input) {
  return String(input ?? "").split(/\r?\n/).map((line) => extractDate(line)).filter(Boolean);
}

function buildRow(platform, date, amountInfo, method, options = {}) {
  const confidence = options.confidenceOverride ?? (method === "exact_text" ? 0.9 : method === "line_plus_next_amount" ? 0.78 : method === "visual_estimate_from_total" ? 0.75 : method === "chart_estimate_from_total" ? 0.7 : 0.62);
  return {
    platform: platform === "unknown" ? "uber" : platform,
    earningDate: date,
    amount: round2(amountInfo.value),
    currency: amountInfo.currency,
    parseStatus: confidence >= 0.7 ? "parsed" : "manual_review",
    parseConfidence: confidence,
    parseMethod: method,
    valueSourceType: method === "exact_text" || method === "line_plus_next_amount" ? "exact_text" : method === "visual_estimate_from_total" ? "visual_estimate" : method === "chart_estimate_from_total" || method === "summary_fallback" ? "fallback_estimate" : "missing",
    extractionNotes: options.notePrefix ?? `Extracted using ${method}.`,
  };
}

function dedupeRows(rows) {
  const set = new Set();
  return rows.filter((row) => {
    const key = `${row.platform}::${row.earningDate}::${row.amount}::${row.parseMethod}`;
    if (set.has(key)) return false;
    set.add(key);
    return true;
  });
}

function buildParsedFileSummary(args) {
  const rows = (args.extraction.rows ?? []).map((row, index) => ({
    id: `${args.fileName}_${index}`,
    platform: row.platform,
    earningDate: row.earningDate,
    amount: row.amount,
    currency: row.currency,
    parseStatus: row.parseStatus,
    parseConfidence: row.parseConfidence,
    parseMethod: row.parseMethod,
    valueSourceType: row.valueSourceType,
    extractionNotes: row.extractionNotes,
    detectedPlatform: args.detection.platform,
  }));
  const lowConfidenceRowCount = rows.filter((row) => !Number.isFinite(row.parseConfidence) || row.parseConfidence < 0.65).length;
  const estimatedRowsTotal = round2(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
  const rowTotalMatchesDetectedTotal = args.extraction.detectedTotal == null ? null : Math.abs(estimatedRowsTotal - args.extraction.detectedTotal) < 0.01;
  const batchConfidence = deriveBatchConfidence({
    parseMethod: args.extraction.parseMethod || args.fallbackParseMethod,
    lowConfidenceRowCount,
    rowsExtractedCount: rows.length,
    rowTotalMatchesDetectedTotal,
    visualDetectionUsed: Boolean(args.extraction.visualDetectionUsed),
  });

  return {
    fileName: args.fileName,
    parseMethod: args.extraction.parseMethod || args.fallbackParseMethod,
    detectedPlatform: args.detection.platform,
    rowsExtractedCount: rows.length,
    lowConfidenceRowCount,
    detectedPeriodStart: args.extraction.detectedPeriodStart ?? null,
    detectedPeriodEnd: args.extraction.detectedPeriodEnd ?? null,
    detectedTotal: args.extraction.detectedTotal ?? null,
    detectedWeeklyTotal: args.extraction.detectedWeeklyTotal ?? args.extraction.detectedTotal ?? null,
    detectedEstimatedDaysCount: rows.filter((row) => row.amount > 0).length,
    estimatedRowsTotal,
    rowTotalMatchesDetectedTotal,
    reconciliationSucceeded: rowTotalMatchesDetectedTotal === true,
    batchConfidence,
    barsDetectedCount: args.extraction.barsDetectedCount ?? 0,
    daysMappedCount: args.extraction.daysMappedCount ?? 0,
    visualDetectionUsed: Boolean(args.extraction.visualDetectionUsed),
    visualDiagnostics: args.extraction.visualDiagnostics ?? null,
    fallbackReason: args.extraction.fallbackReason ?? null,
    rows,
  };
}

function deriveBatchConfidence(args) {
  if (args.rowsExtractedCount === 0) return "low";
  if (args.parseMethod === "exact_text" && args.lowConfidenceRowCount === 0) return "high";
  if ((args.parseMethod === "visual_estimate_from_total" || args.parseMethod === "chart_estimate_from_total") && args.rowTotalMatchesDetectedTotal === true) {
    return args.visualDetectionUsed ? "high" : "medium";
  }
  if (args.parseMethod === "line_plus_next_amount" && args.lowConfidenceRowCount === 0) return "medium";
  return "low";
}

function bumpScore(score, platform, haystack, needles, weight) {
  for (const needle of needles) if (haystack.includes(needle)) score[platform] += weight;
}
function normalizePlatform(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "uber" || raw === "lyft" || raw === "bolt") return raw;
  return null;
}
function symbolToCurrency(symbol) { if (symbol === "$") return "USD"; if (symbol === "\u20AC") return "EUR"; return "GBP"; }
function parseMoney(raw) {
  const input = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!input) return NaN;
  const commas = (input.match(/,/g) || []).length;
  const dots = (input.match(/\./g) || []).length;
  if (commas > 0 && dots > 0) return input.lastIndexOf(",") > input.lastIndexOf(".") ? Number(input.replace(/\./g, "").replace(",", ".")) : Number(input.replace(/,/g, ""));
  if (commas > 0 && dots === 0) return /,\d{2}$/.test(input) ? Number(input.replace(",", ".")) : Number(input.replace(/,/g, ""));
  if (dots > 1) { const idx = input.lastIndexOf("."); return Number(`${input.slice(0, idx).replace(/\./g, "")}.${input.slice(idx + 1)}`); }
  return Number(input);
}
function sanitizeText(value) { return String(value ?? "").replace(/\u00C3\u201A\u00C2\u00A3|\u00C3\u0192\u00E2\u201A\u0161\u00C3\u201A\u00C2\u00A3|\u00C2\u00A3/g, "\u00A3").replace(/\u00C3\u00A2\u20AC\u0161\u00C2\u00AC|\u00C3\u0192\u00C2\u00A2\u00C3\u00A2\u201A\u00AC\u00C5\u00A1\u00C3\u201A\u00C2\u00AC|\u00E2\u201A\u00AC/g, "\u20AC").replace(/[‐‑‒–—]/g, "-").replace(/\u00A0/g, " "); }
function normalizeToken(value) { return sanitizeText(value).toLowerCase().replace(/[^a-z]/g, ""); }
function resolveWeekday(token) { for (const alias of WEEKDAYS) if (alias.labels.includes(token)) return alias.key; return null; }
function isFiniteNumber(value) { return typeof value === "number" && Number.isFinite(value); }
function round2(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function clamp(value, min, max) { if (!Number.isFinite(value)) return min; return Math.max(min, Math.min(max, Math.floor(value))); }
function isoDate(year, month, day) { return `${year}-${String(clamp(month,1,12)).padStart(2, "0")}-${String(clamp(day,1,31)).padStart(2, "0")}`; }
function enumerateDates(startDate, endDate) { const out = []; let cursor = startDate; while (cursor <= endDate) { out.push(cursor); cursor = shiftDays(cursor, 1); } return out; }
function shiftDays(isoDateValue, days) { const d = new Date(`${isoDateValue}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function weekdayFromIso(isoDateValue) { return new Date(`${isoDateValue}T00:00:00.000Z`).getUTCDay(); }
function normalizeIsoDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}
function diffInDays(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.floor((end - start) / 86400000);
}
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function saturation(rgba) { const r = rgba.r / 255; const g = rgba.g / 255; const b = rgba.b / 255; const max = Math.max(r, g, b); const min = Math.min(r, g, b); if (max === 0) return 0; return (max - min) / max; }
function estimateBgLuma(image, minX, maxX, minY, maxY) { let sum = 0; let count = 0; for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) { const rgba = Jimp.intToRGBA(image.getPixelColor(x, y)); sum += 0.2126 * rgba.r + 0.7152 * rgba.g + 0.0722 * rgba.b; count += 1; } return count === 0 ? 128 : sum / count; }
function smoothScores(scores, radius) { const r = Math.max(0, Math.floor(radius)); return scores.map((entry, idx) => { let sum = 0; let count = 0; let topY = null; for (let i = idx - r; i <= idx + r; i += 1) { const row = scores[i]; if (!row) continue; sum += row.active; count += 1; if (row.topY != null && (topY == null || row.topY < topY)) topY = row.topY; } return { x: entry.x, active: count > 0 ? sum / count : entry.active, topY }; }); }
function collectSegments(scores, threshold) { const out = []; let current = null; for (const score of scores) { if (score.active >= threshold) { if (!current) current = { startX: score.x, endX: score.x, topY: score.topY }; else { current.endX = score.x; if (score.topY != null && (current.topY == null || score.topY < current.topY)) current.topY = score.topY; } } else if (current) { out.push(current); current = null; } } if (current) out.push(current); return out; }
function percentile(values, p) { if (!values.length) return 0; const sorted = [...values].sort((a,b) => a - b); const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1); return sorted[idx]; }
function median(values) { if (!values.length) return 0; const sorted = [...values].sort((a,b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]; }
function medianDiff(values) { if (values.length < 2) return 0; const diffs = []; for (let i = 1; i < values.length; i += 1) diffs.push(Math.abs(values[i] - values[i - 1])); return median(diffs); }

module.exports = {
  createEarningsOcrService,
  __test: {
    async parseFromOcrSnapshot(input) {
      const fileName = String(input?.fileName ?? "snapshot");
      const text = sanitizeText(String(input?.text ?? ""));
      const words = Array.isArray(input?.words) ? input.words : [];
      const hintedPlatform = normalizePlatform(input?.platformHint);
      const detection = detectPlatform(text, fileName, hintedPlatform);
      const extraction = await extractRows({ text, words, imageBuffer: input?.imageBuffer ?? null, fileName, detectedPlatform: detection.platform });
      return buildParsedFileSummary({ fileName, detection, extraction, fallbackParseMethod: "snapshot" });
    },
  },
};
