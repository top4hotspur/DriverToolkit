const { createWorker } = require("tesseract.js");

const CATEGORY_RULES = [
  { category: "fuel", keywords: ["fuel", "petrol", "diesel", "forecourt", "unleaded", "super unleaded"] },
  { category: "parking", keywords: ["parking", "car park", "ncp", "parkmobile", "ringgo"] },
  { category: "tolls", keywords: ["toll", "tunnel fee", "bridge fee", "road charge"] },
  { category: "cleaning", keywords: ["car wash", "valet", "cleaning", "detailing"] },
  { category: "maintenance", keywords: ["service", "repair", "garage", "tyre", "mot", "parts"] },
  { category: "food", keywords: ["restaurant", "cafe", "coffee", "meal", "food"] },
  { category: "phone/data", keywords: ["mobile", "phone", "vodafone", "o2", "ee", "three", "data plan"] },
  { category: "insurance", keywords: ["insurance", "policy", "premium"] },
];

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function createReceiptOcrService() {
  async function parseReceipt(input) {
    const fileName = String(input?.fileName ?? "unknown_file");
    const base64Data = String(input?.base64Data ?? "");
    const sourceType = normalizeSourceType(input?.sourceType);
    let parseMethod = "tesseract_ocr";
    let rawText = "";
    let parseError = null;

    try {
      if (!base64Data) {
        throw new Error("missing_base64");
      }
      rawText = await runOcr(base64Data);
    } catch (error) {
      parseError = error instanceof Error ? error.message : "ocr_failed";
      parseMethod = "ocr_failed_fallback";
      rawText = "";
    }

    const date = extractDate(rawText);
    const amountInfo = extractTotalAmount(rawText);
    const merchant = extractMerchant(rawText, fileName);
    const suggestedCategory = suggestCategory(rawText, merchant);
    const confidence = computeConfidence({
      hasDate: Boolean(date),
      hasAmount: Boolean(amountInfo),
      hasMerchant: Boolean(merchant),
      usedOcr: parseMethod === "tesseract_ocr",
    });
    const parseStatus = confidence >= 0.7 ? "parsed" : "manual_review";

    const expenseDate = date ?? new Date().toISOString().slice(0, 10);
    const amount = amountInfo?.value ?? 0;
    const currency = amountInfo?.currency ?? "GBP";

    const extractionNotes = [
      parseError ? `OCR error: ${parseError}` : null,
      date ? null : "Date not confidently detected.",
      amountInfo ? null : "Total amount not confidently detected.",
      merchant ? null : "Merchant not confidently detected.",
    ]
      .filter(Boolean)
      .join(" ");

    console.log(
      `[EXPENSES][ocr] file=${fileName} merchant=${merchant ?? "n/a"} date=${expenseDate} amount=${amount} category=${
        suggestedCategory ?? "other"
      } confidence=${confidence.toFixed(2)} status=${parseStatus} method=${parseMethod}`,
    );

    return {
      ok: true,
      draft: {
        expenseDate,
        amount,
        currency,
        category: suggestedCategory ?? "other",
        merchantName: merchant,
        sourceType,
        parseStatus,
        parseConfidence: confidence,
        parseMethod,
        extractionNotes: extractionNotes || "Extraction complete.",
      },
      diagnostics: {
        sourceFileName: fileName,
        detectedMerchant: merchant,
        detectedDate: date,
        detectedAmount: amountInfo?.value ?? null,
        suggestedCategory: suggestedCategory ?? "other",
        parseConfidence: confidence,
        parseStatus,
        parseMethod,
      },
    };
  }

  return {
    parseReceipt,
  };
}

async function runOcr(base64Data) {
  const worker = await createWorker("eng");
  try {
    const imageBuffer = Buffer.from(base64Data, "base64");
    const result = await worker.recognize(imageBuffer);
    return String(result?.data?.text ?? "");
  } finally {
    await worker.terminate();
  }
}

function extractDate(text) {
  const safe = String(text ?? "");
  const iso = safe.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const dmy = safe.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (dmy) {
    const year = dmy[3] ? Number(dmy[3]) : new Date().getUTCFullYear();
    const day = clamp(Number(dmy[1]), 1, 31);
    const month = clamp(Number(dmy[2]), 1, 12);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const named = safe.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(20\d{2}))?\b/);
  if (named) {
    const month = MONTHS[String(named[2] ?? "").toLowerCase()];
    if (!month) {
      return null;
    }
    const year = named[3] ? Number(named[3]) : new Date().getUTCFullYear();
    const day = clamp(Number(named[1]), 1, 31);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function extractTotalAmount(text) {
  const safe = String(text ?? "");
  const lines = safe.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const totalLine = lines.find((line) => /(^|\s)(total|amount due|grand total|to pay)(\s|:|$)/i.test(line));
  if (totalLine) {
    const amount = extractAmountFromLine(totalLine);
    if (amount) {
      return amount;
    }
  }
  let maxAmount = null;
  for (const line of lines) {
    const amount = extractAmountFromLine(line);
    if (!amount) {
      continue;
    }
    if (!maxAmount || amount.value > maxAmount.value) {
      maxAmount = amount;
    }
  }
  return maxAmount;
}

function extractAmountFromLine(line) {
  const safe = String(line ?? "");
  const matches = [...safe.matchAll(/(£|\$|€)?\s?(\d{1,5}(?:[.,]\d{2}))/g)];
  if (matches.length === 0) {
    return null;
  }
  const last = matches[matches.length - 1];
  const value = Number(String(last[2] ?? "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0 || value > 100000) {
    return null;
  }
  return {
    value: Number(value.toFixed(2)),
    currency: symbolToCurrency(last[1]),
  };
}

function extractMerchant(text, fileName) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 10)) {
    const safe = line.replace(/[^a-zA-Z0-9 '&.-]/g, "").trim();
    if (!safe) {
      continue;
    }
    if (/receipt|invoice|vat|total|amount|date|time|card|payment/i.test(safe)) {
      continue;
    }
    if (safe.length >= 3) {
      return safe;
    }
  }

  const inferredFromName = String(fileName ?? "").replace(/\.[a-z0-9]+$/i, "");
  const cleaned = inferredFromName.replace(/[_-]+/g, " ").trim();
  return cleaned.length >= 3 ? cleaned : null;
}

function suggestCategory(text, merchant) {
  const haystack = `${String(text ?? "").toLowerCase()} ${String(merchant ?? "").toLowerCase()}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return rule.category;
    }
  }
  return "other";
}

function computeConfidence(args) {
  let score = args.usedOcr ? 0.35 : 0.2;
  if (args.hasDate) score += 0.2;
  if (args.hasAmount) score += 0.3;
  if (args.hasMerchant) score += 0.15;
  return Math.max(0.2, Math.min(0.95, score));
}

function normalizeSourceType(value) {
  const raw = String(value ?? "").trim();
  if (raw === "receipt_file" || raw === "receipt_photo" || raw === "manual") {
    return raw;
  }
  return "receipt_file";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function symbolToCurrency(symbol) {
  if (symbol === "$") return "USD";
  if (symbol === "€") return "EUR";
  return "GBP";
}

module.exports = {
  createReceiptOcrService,
};
