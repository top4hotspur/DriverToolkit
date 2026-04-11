const fs = require("fs");
const path = require("path");
const Jimp = require("jimp");
const { __test } = require("../earningsOcr");

const OUTPUT_DIR = path.join(__dirname, "fixtures", "uber-weekly-generated");
const REAL_DIR = process.env.UBER_WEEKLY_VALIDATION_DIR || path.join(__dirname, "fixtures", "uber-weekly-real");

async function ensureGeneratedFixtures() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  const dark = 0x121212ff;
  const blue = 0x3f7bffff;
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const cases = [
    { id: "case_1", total: "£1,283.40", period: "23 Mar - 30 Mar", bars: [48, 66, 74, 40, 82, 61, 57] },
    { id: "case_2", total: "£980.10", period: "6 Apr - 13 Apr", bars: [22, 54, 63, 72, 68, 45, 30] },
    { id: "case_3", total: "£740.70", period: "Mar 23 - Mar 30", bars: [35, 35, 35, 35, 35, 35, 35] },
    { id: "case_4", total: "£500.00", period: "1 Apr - 8 Apr", bars: [10, 0, 28, 34, 22, 8, 0] },
    { id: "case_5", total: "£1100.25", period: "10 Apr - 17 Apr", bars: [70, 62, 64, 77, 75, 73, 71] },
  ];

  const files = [];
  for (const testCase of cases) {
    const width = 820;
    const height = 520;
    const img = new Jimp(width, height, dark);
    img.print(font, 28, 18, "Uber");
    img.print(font, 28, 44, "This week");
    img.print(font, 28, 70, testCase.period);
    img.print(font, 28, 96, `Total ${testCase.total}`);

    const chartLeft = 70;
    const chartRight = width - 70;
    const chartBottom = 430;
    const chartTop = 170;
    const span = chartRight - chartLeft;
    const gap = span / labels.length;

    const words = [];
    for (let i = 0; i < labels.length; i += 1) {
      const xCenter = chartLeft + gap * i + gap / 2;
      const label = labels[i];
      const labelX = Math.round(xCenter - 18);
      img.print(font, labelX, 446, label);
      words.push({ text: label, x0: labelX, x1: labelX + 30, y0: 446, y1: 466 });

      const barHeight = Math.round(((chartBottom - chartTop) * testCase.bars[i]) / 100);
      const barTop = chartBottom - barHeight;
      const barLeft = Math.round(xCenter - 14);
      for (let x = barLeft; x < barLeft + 28; x += 1) {
        for (let y = Math.max(chartTop, barTop); y <= chartBottom; y += 1) {
          img.setPixelColor(blue, x, y);
        }
      }
    }

    const filePath = path.join(OUTPUT_DIR, `${testCase.id}.png`);
    await img.writeAsync(filePath);
    files.push({
      id: testCase.id,
      filePath,
      text: `Uber\nThis week\n${testCase.period}\nTotal ${testCase.total}\n${labels.join(" ")}`,
      words,
      fixtureType: "generated_image_fixture",
    });
  }
  return files;
}

function loadRealFixtures() {
  if (!fs.existsSync(REAL_DIR)) return [];
  const files = fs
    .readdirSync(REAL_DIR)
    .filter((name) => /\.(png|jpg|jpeg|webp)$/i.test(name))
    .map((name) => ({
      id: path.parse(name).name,
      filePath: path.join(REAL_DIR, name),
      fixtureType: "real_screenshot",
    }));
  return files;
}

async function run() {
  const realFixtures = loadRealFixtures();
  const generated = await ensureGeneratedFixtures();
  const fixtures = realFixtures.length > 0 ? realFixtures : generated;

  const results = [];
  for (const fixture of fixtures) {
    const imageBuffer = fs.readFileSync(fixture.filePath);
    const parsed = await __test.parseFromOcrSnapshot({
      fileName: path.basename(fixture.filePath),
      platformHint: "uber",
      text:
        fixture.text ||
        "Uber\nThis week\n23 Mar - 30 Mar\nTotal £1,000.00\nMon Tue Wed Thu Fri Sat Sun",
      words: fixture.words || [],
      imageBuffer,
    });

    results.push({
      id: fixture.id,
      fixtureType: fixture.fixtureType,
      detectedPlatform: parsed.detectedPlatform,
      detectedPeriodStart: parsed.detectedPeriodStart,
      detectedPeriodEnd: parsed.detectedPeriodEnd,
      detectedWeeklyTotal: parsed.detectedWeeklyTotal,
      barsDetectedCount: parsed.barsDetectedCount,
      daysMappedCount: parsed.daysMappedCount,
      estimatedRowsCount: parsed.rowsExtractedCount,
      estimatedRowsTotal: parsed.estimatedRowsTotal,
      reconciliationSucceeded: parsed.reconciliationSucceeded,
      batchConfidence: parsed.batchConfidence,
      manualInputLikelyRequired: parsed.batchConfidence === "low" || parsed.reconciliationSucceeded !== true,
    });
  }

  console.log(
    JSON.stringify(
      {
        realScreenshotDir: REAL_DIR,
        realScreenshotsFound: realFixtures.length,
        modeUsed: realFixtures.length > 0 ? "real_screenshots" : "generated_image_fixtures",
        caseCount: results.length,
        results,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
