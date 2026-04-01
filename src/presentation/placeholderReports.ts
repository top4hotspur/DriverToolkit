import { DetailedAnalysisContract, ReportCardContract } from "../contracts/reports";
import { getReportRegistryEntry, REPORT_REGISTRY } from "../contracts/reportRegistry";
import { ReportAdminSectionContract } from "../contracts/recovery";
import { ReportType } from "../domain/types";

const defaultBasis = {
  days: 90,
  label: "Based on last 90 days",
  reason: "default" as const,
};

export interface ReportsUploadStatusPlaceholder {
  state: "ready-for-upload" | "imported-recently";
  title: string;
  subtitle: string;
  ctaLabel: string;
}

export const placeholderReportsUploadStatus: ReportsUploadStatusPlaceholder = {
  state: "imported-recently",
  title: "Data basis refreshed",
  subtitle: "Last privacy export imported 2 days ago. Recommendations remain historical, not live.",
  ctaLabel: "Upload latest privacy file",
};

const cardInsights: Record<ReportType, { insightNudge: string; confidence: ReportCardContract["confidence"]; sampleSize: number }> = {
  "journey-regret": {
    insightNudge: "Trips to BT36 under £18 underperform 71% of the time.",
    confidence: "MEDIUM",
    sampleSize: 14,
  },
  "area-performance": {
    insightNudge: "University Area is your best Friday 90-minute start window.",
    confidence: "HIGH",
    sampleSize: 33,
  },
  "hour-vs-mile": {
    insightNudge: "Short inner-city jobs win hourly; suburb chains win per mile.",
    confidence: "MEDIUM",
    sampleSize: 21,
  },
  "best-start-areas": {
    insightNudge: "North Dock still leads weekday 17:00 starts by +£3.60/hr.",
    confidence: "HIGH",
    sampleSize: 29,
  },
  "dead-mile-traps": {
    insightNudge: "Airport loops add an average 2.4 dead miles per trip.",
    confidence: "MEDIUM",
    sampleSize: 16,
  },
  "queue-traps": {
    insightNudge: "Airport queues after 20:00 reduce your hourly rate by £5 on average.",
    confidence: "LOW",
    sampleSize: 7,
  },
  "follow-on-strength": {
    insightNudge: "Station drop-offs produce a follow-on within 12 minutes 44% of the time.",
    confidence: "MEDIUM",
    sampleSize: 13,
  },
  "earnings-leaks": {
    insightNudge: "Three likely payout gaps total £26.40 in recoverable value.",
    confidence: "MEDIUM",
    sampleSize: 9,
  },
  "tip-patterns": {
    insightNudge: "Late Friday city-centre runs lead tip density by +£0.90/mile.",
    confidence: "LOW",
    sampleSize: 6,
  },
  "time-of-day-winners-losers": {
    insightNudge: "19:00-21:00 weekdays outperform your average by +£4.10/hr.",
    confidence: "HIGH",
    sampleSize: 41,
  },
  achievements: {
    insightNudge: "Best £/hr trip from your history is currently £42.80/hr.",
    confidence: "HIGH",
    sampleSize: 55,
  },
};

export const placeholderReportCards: ReportCardContract[] = REPORT_REGISTRY.map((entry) => ({
  type: entry.id,
  title: entry.title,
  summary: entry.shortDescription,
  insightNudge: cardInsights[entry.id].insightNudge,
  confidence: cardInsights[entry.id].confidence,
  sampleSize: cardInsights[entry.id].sampleSize,
  basisWindow: defaultBasis,
}));

export const placeholderReportDetails: Record<ReportType, DetailedAnalysisContract> = {
  "journey-regret": {
    reportType: "journey-regret",
    title: "Journey Regret",
    correctToDate: "2026-03-30",
    basisWindowNote: "Based on last 90 days",
    confidenceLabel: "Medium confidence",
    actionableInsight: "Airport queue starts after 20:00 repeatedly miss your hourly target once wait and return miles are counted.",
    comparisonRows: [
      { label: "Avg true net/hour", yourValue: "£13.40", comparableValue: "£17.80", delta: "-£4.40" },
      { label: "Avg dead miles", yourValue: "4.6", comparableValue: "2.1", delta: "+2.5" },
      { label: "Follow-on rate", yourValue: "24%", comparableValue: "39%", delta: "-15%" },
    ],
    takeaway: "Avoid long queue commitments unless an offer clears your threshold quickly.",
    ifThenRules: [
      { if: "IF airport holding wait exceeds 8 minutes", then: "THEN reposition unless first offer is at least £14.20" },
      { if: "IF expected return dead miles exceed 3", then: "THEN only accept if projected true net/hour remains above target" },
    ],
  },
  "area-performance": {
    reportType: "area-performance",
    title: "Area Performance",
    correctToDate: "2026-03-30",
    basisWindowNote: "Based on last 90 days",
    confidenceLabel: "High confidence",
    actionableInsight: "BT7 weekday evenings are consistently stronger than city centre starts on both hourly and per-mile outcomes.",
    comparisonRows: [
      { label: "BT7 true net/hour", yourValue: "£20.40", comparableValue: "£16.90", delta: "+£3.50" },
      { label: "BT7 true net/mile", yourValue: "£1.34", comparableValue: "£1.10", delta: "+£0.24" },
      { label: "Average wait", yourValue: "5.8 min", comparableValue: "7.9 min", delta: "-2.1 min" },
    ],
    takeaway: "Prioritize BT7 starts in your strongest evening window when available.",
    ifThenRules: [
      { if: "IF weekday 17:00-19:30 and near BT7", then: "THEN prefer BT7 start over city centre hold" },
      { if: "IF BT7 wait exceeds 9 minutes", then: "THEN fall back to North Dock strategy" },
    ],
  },
  "hour-vs-mile": {
    reportType: "hour-vs-mile",
    title: "£/Hour vs £/Mile",
    correctToDate: "2026-03-30",
    basisWindowNote: "Based on last 90 days",
    confidenceLabel: "Medium confidence",
    actionableInsight: "Your short urban trips optimize hourly value, but medium suburb trips produce stronger per-mile returns.",
    comparisonRows: [
      { label: "Urban short trips (£/hour)", yourValue: "£22.10", comparableValue: "£17.40", delta: "+£4.70" },
      { label: "Suburb medium trips (£/mile)", yourValue: "£1.42", comparableValue: "£1.11", delta: "+£0.31" },
      { label: "Target gap hourly", yourValue: "-£1.20", comparableValue: "-£3.10", delta: "+£1.90" },
    ],
    takeaway: "Choose trip style based on whether you are chasing time or distance efficiency this shift.",
    ifThenRules: [
      { if: "IF current shift target is hourly recovery", then: "THEN prioritize dense short-trip zones" },
      { if: "IF fuel price pressure increases", then: "THEN bias toward stronger per-mile windows" },
    ],
  },
  "best-start-areas": {
    reportType: "best-start-areas",
    title: "Best Start Areas",
    correctToDate: "2026-03-30",
    basisWindowNote: "Based on last 90 days",
    confidenceLabel: "High confidence",
    actionableInsight: "North Dock and University Area rotate as your top first-90-minute starting points.",
    comparisonRows: [
      { label: "North Dock 90-min yield", yourValue: "£28.10", comparableValue: "£22.40", delta: "+£5.70" },
      { label: "University Area 90-min yield", yourValue: "£27.30", comparableValue: "£22.40", delta: "+£4.90" },
      { label: "City Centre 90-min yield", yourValue: "£21.80", comparableValue: "£22.40", delta: "-£0.60" },
    ],
    takeaway: "Use your top two start areas as default opening plays when comparable context matches.",
    ifThenRules: [
      { if: "IF Friday 18:00-20:00", then: "THEN start in University Area first" },
      { if: "IF weekday 16:30-18:30", then: "THEN start in North Dock unless event signal says otherwise" },
    ],
  },
  "dead-mile-traps": {
    reportType: "dead-mile-traps",
    title: "Dead Mile Traps",
    correctToDate: "2026-03-30",
    basisWindowNote: "Expanded to 6 months due to low sample size",
    confidenceLabel: "Medium confidence",
    actionableInsight: "Outer-ring airport returns repeatedly create dead-mile penalties that erase tip gains.",
    comparisonRows: [
      { label: "Trap-zone dead miles", yourValue: "4.4", comparableValue: "2.0", delta: "+2.4" },
      { label: "Return penalty", yourValue: "£2.90", comparableValue: "£1.20", delta: "+£1.70" },
      { label: "True net/mile", yourValue: "£0.92", comparableValue: "£1.28", delta: "-£0.36" },
    ],
    takeaway: "Do not chase nominal fare if dead-mile tendency is consistently high.",
    ifThenRules: [
      { if: "IF projected dead miles exceed 3", then: "THEN require higher minimum fare threshold" },
      { if: "IF return direction lacks demand", then: "THEN reposition before accepting long outbound runs" },
    ],
  },
  "queue-traps": {
    reportType: "queue-traps",
    title: "Queue Traps",
    correctToDate: "2026-03-30",
    basisWindowNote: "Expanded to 6 months due to low sample size",
    confidenceLabel: "Low confidence",
    actionableInsight: "Queue waits above 11 minutes in your sampled contexts usually fail to recover target gaps.",
    comparisonRows: [
      { label: "Wait > 11 min true net/hour", yourValue: "£11.90", comparableValue: "£17.00", delta: "-£5.10" },
      { label: "Median first fare", yourValue: "£8.70", comparableValue: "£10.90", delta: "-£2.20" },
      { label: "Follow-on rate", yourValue: "22%", comparableValue: "34%", delta: "-12%" },
    ],
    takeaway: "Treat long queues as short-wait-only until stronger evidence supports otherwise.",
    ifThenRules: [
      { if: "IF queue wait exceeds 11 minutes", then: "THEN switch to reposition plan" },
      { if: "IF queue zone has weak follow-on history", then: "THEN avoid second wait cycle" },
    ],
  },
  "follow-on-strength": {
    reportType: "follow-on-strength",
    title: "Follow-On Strength",
    correctToDate: "2026-03-30",
    basisWindowNote: "Based on last 90 days",
    confidenceLabel: "Medium confidence",
    actionableInsight: "Station Corridor drop-offs generate your strongest next-job momentum within 15 minutes.",
    comparisonRows: [
      { label: "Follow-on within 15 min", yourValue: "44%", comparableValue: "31%", delta: "+13%" },
      { label: "60-min yield after drop", yourValue: "£19.60", comparableValue: "£15.10", delta: "+£4.50" },
      { label: "Average wait", yourValue: "5.1 min", comparableValue: "7.3 min", delta: "-2.2 min" },
    ],
    takeaway: "Use high follow-on zones to stabilize earnings in uncertain periods.",
    ifThenRules: [
      { if: "IF finishing near Station Corridor", then: "THEN hold briefly for follow-on opportunity" },
      { if: "IF no follow-on within 8 minutes", then: "THEN reposition to next strongest start area" },
    ],
  },
  "earnings-leaks": {
    reportType: "earnings-leaks",
    title: "Earnings Leaks",
    correctToDate: "2026-03-30",
    basisWindowNote: "Based on last 90 days",
    confidenceLabel: "Medium confidence",
    actionableInsight: "Missing surcharge and wait-time anomalies account for most current recoverable value.",
    comparisonRows: [
      { label: "Estimated recoverable value", yourValue: "£26.40", comparableValue: "£14.20", delta: "+£12.20" },
      { label: "Leak count", yourValue: "3", comparableValue: "2", delta: "+1" },
      { label: "Avg leak value", yourValue: "£8.80", comparableValue: "£7.10", delta: "+£1.70" },
    ],
    takeaway: "Prioritize claim-helper actions for higher-confidence leak types first.",
    ifThenRules: [
      { if: "IF leak type is missing-surcharge with medium confidence", then: "THEN send claim request with trip timestamps" },
      { if: "IF underpayment confidence remains low", then: "THEN mark for manual review before claim" },
    ],
  },
  "tip-patterns": {
    reportType: "tip-patterns",
    title: "Tip Patterns",
    correctToDate: "2026-03-30",
    basisWindowNote: "Expanded to 6 months due to low sample size",
    confidenceLabel: "Low confidence",
    actionableInsight: "Friday late-evening city-centre runs are your strongest tip-per-mile context.",
    comparisonRows: [
      { label: "Tip per mile (Fri late)", yourValue: "£1.12", comparableValue: "£0.55", delta: "+£0.57" },
      { label: "Tip rate", yourValue: "41%", comparableValue: "27%", delta: "+14%" },
      { label: "Average tip amount", yourValue: "£3.80", comparableValue: "£2.50", delta: "+£1.30" },
    ],
    takeaway: "Lean into contexts with both strong tip rate and stable base fare outcomes.",
    ifThenRules: [
      { if: "IF Fri 20:00-23:30 in city-centre", then: "THEN maintain position for higher tip probability" },
      { if: "IF tip-rate signal is low confidence", then: "THEN treat as light nudge, not hard rule" },
    ],
  },
  "time-of-day-winners-losers": {
    reportType: "time-of-day-winners-losers",
    title: "Time-of-Day Winners / Losers",
    correctToDate: "2026-03-30",
    basisWindowNote: "Based on last 90 days",
    confidenceLabel: "High confidence",
    actionableInsight: "Weekday 19:00-21:00 is your strongest recurring winner window; late-night airport holds are the biggest loser.",
    comparisonRows: [
      { label: "Winner window true net/hour", yourValue: "£22.30", comparableValue: "£16.90", delta: "+£5.40" },
      { label: "Loser window true net/hour", yourValue: "£11.80", comparableValue: "£16.90", delta: "-£5.10" },
      { label: "Winner target gap", yourValue: "-£4.30", comparableValue: "-£0.80", delta: "-£3.50" },
    ],
    takeaway: "Protect your winner windows and avoid overcommitting in known loser periods.",
    ifThenRules: [
      { if: "IF weekday 19:00-21:00 available", then: "THEN prioritize active positioning in high-follow-on zones" },
      { if: "IF late-night window enters queue trap profile", then: "THEN switch to short-wait-only strategy" },
    ],
  },
  achievements: {
    reportType: "achievements",
    title: "Achievements",
    correctToDate: "2026-03-30",
    basisWindowNote: "Based on last 90 days",
    confidenceLabel: "High confidence",
    actionableInsight: "Your standout highs and lows are consistent enough to share and still useful for decision reflection.",
    comparisonRows: [
      { label: "Best £/hr trip", yourValue: "£42.80/hr", comparableValue: "£33.10/hr", delta: "+£9.70/hr" },
      { label: "Worst £/mile trip", yourValue: "£0.88/mile", comparableValue: "£1.04/mile", delta: "-£0.16/mile" },
      { label: "Best tip", yourValue: "£11.40", comparableValue: "£8.20", delta: "+£3.20" },
    ],
    takeaway: "Use these records as motivation, but keep decisions grounded in repeatable context patterns.",
    ifThenRules: [
      { if: "IF new record appears in strong-confidence context", then: "THEN consider sharing with your driver group" },
      { if: "IF low-confidence outlier appears", then: "THEN treat as fun signal, not strategy change" },
    ],
  },
};

export const placeholderReportsAdminSection: ReportAdminSectionContract = {
  adminSummary: "Local-first admin records are stored on device and remain optional support context.",
  receiptInputModes: ["camera", "file-upload"],
  records: [
    {
      id: "expense-001",
      category: "expense",
      title: "Fuel receipt",
      amount: 46.2,
      occurredAt: "2026-03-28",
      receipt: {
        receiptSourceType: "camera",
        localReceiptUri: "file:///receipts/fuel-2026-03-28.jpg",
        mimeType: "image/jpeg",
        originalFileName: null,
        fileSizeBytes: 220144,
      },
      notes: "Captured at station kiosk.",
      syncState: "local-only",
    },
    {
      id: "expense-002",
      category: "receipt",
      title: "Car wash invoice",
      amount: 14.5,
      occurredAt: "2026-03-27",
      receipt: {
        receiptSourceType: "file-upload",
        localReceiptUri: "file:///downloads/carwash-invoice.pdf",
        mimeType: "application/pdf",
        originalFileName: "carwash-invoice.pdf",
        fileSizeBytes: 84512,
      },
      notes: "Downloaded from email and uploaded from device files.",
      syncState: "local-only",
    },
    {
      id: "tax-001",
      category: "tax-note",
      title: "Quarterly VAT note",
      amount: null,
      occurredAt: "2026-03-26",
      receipt: null,
      notes: "Reminder only, no upload.",
      syncState: "local-only",
    },
  ],
};

export function getPlaceholderReportDetail(reportId: ReportType): DetailedAnalysisContract {
  return placeholderReportDetails[reportId] ?? placeholderReportDetails["journey-regret"];
}

export function getReportDisplayTitle(reportId: ReportType): string {
  return getReportRegistryEntry(reportId).title;
}
