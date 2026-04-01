import { ReportType } from "../domain/types";

export type ReportCategory =
  | "decision-quality"
  | "area-intelligence"
  | "efficiency"
  | "recovery"
  | "growth";

export interface ReportRegistryEntry {
  id: ReportType;
  title: string;
  shortDescription: string;
  category: ReportCategory;
  primaryQuestionAnswered: string;
  detailRoute: string;
  emptyStateCopy: string;
  status: "placeholder";
  supportsShare: boolean;
}

export const REPORT_REGISTRY: ReadonlyArray<ReportRegistryEntry> = [
  {
    id: "journey-regret",
    title: "Journey Regret",
    shortDescription: "Find trips that looked fine but usually miss your true net goals.",
    category: "decision-quality",
    primaryQuestionAnswered: "Which trips are repeatable bad bets once full costs are included?",
    detailRoute: "/reports/detail/journey-regret",
    emptyStateCopy: "Import more history to detect repeated regret patterns.",
    status: "placeholder",
    supportsShare: true,
  },
  {
    id: "area-performance",
    title: "Area Performance",
    shortDescription: "Compare your actual outcomes by area, not generic city averages.",
    category: "area-intelligence",
    primaryQuestionAnswered: "Where do you personally perform best by true net/hour and true net/mile?",
    detailRoute: "/reports/detail/area-performance",
    emptyStateCopy: "Add more trips across multiple areas to unlock stronger comparisons.",
    status: "placeholder",
    supportsShare: true,
  },
  {
    id: "hour-vs-mile",
    title: "£/Hour vs £/Mile",
    shortDescription: "Expose when time-efficient and distance-efficient decisions diverge.",
    category: "efficiency",
    primaryQuestionAnswered: "Are your current choices optimizing time value, mile value, or neither?",
    detailRoute: "/reports/detail/hour-vs-mile",
    emptyStateCopy: "Need more varied trip lengths to compare hourly and per-mile tradeoffs.",
    status: "placeholder",
    supportsShare: false,
  },
  {
    id: "best-start-areas",
    title: "Best Start Areas",
    shortDescription: "Rank start locations by your own 60/90-minute outcomes.",
    category: "area-intelligence",
    primaryQuestionAnswered: "Where should you start to maximize likely first-window yield?",
    detailRoute: "/reports/detail/best-start-areas",
    emptyStateCopy: "Save start areas and import more starts to rank them reliably.",
    status: "placeholder",
    supportsShare: true,
  },
  {
    id: "dead-mile-traps",
    title: "Dead Mile Traps",
    shortDescription: "Reveal zones where return miles repeatedly drain value.",
    category: "efficiency",
    primaryQuestionAnswered: "Which areas consistently impose dead-mile penalties?",
    detailRoute: "/reports/detail/dead-mile-traps",
    emptyStateCopy: "Need more route history to map dead-mile trap reliability.",
    status: "placeholder",
    supportsShare: false,
  },
  {
    id: "queue-traps",
    title: "Queue Traps",
    shortDescription: "Identify queues where long waits rarely recover your target gaps.",
    category: "decision-quality",
    primaryQuestionAnswered: "Which queue situations are usually not worth waiting out?",
    detailRoute: "/reports/detail/queue-traps",
    emptyStateCopy: "Import more queue-prone sessions to evaluate wait-risk properly.",
    status: "placeholder",
    supportsShare: false,
  },
  {
    id: "follow-on-strength",
    title: "Follow-On Strength",
    shortDescription: "Measure where one trip tends to trigger a second good job quickly.",
    category: "decision-quality",
    primaryQuestionAnswered: "Where are your highest-probability follow-on zones?",
    detailRoute: "/reports/detail/follow-on-strength",
    emptyStateCopy: "Need more consecutive trip chains to score follow-on strength.",
    status: "placeholder",
    supportsShare: true,
  },
  {
    id: "earnings-leaks",
    title: "Earnings Leaks",
    shortDescription: "Surface likely missed pay components and claim opportunities.",
    category: "recovery",
    primaryQuestionAnswered: "Where might your historical payouts be short?",
    detailRoute: "/reports/detail/earnings-leaks",
    emptyStateCopy: "Import more complete records to detect surcharge and payment anomalies.",
    status: "placeholder",
    supportsShare: true,
  },
  {
    id: "tip-patterns",
    title: "Tip Patterns",
    shortDescription: "Track where and when tips are strongest in your own history.",
    category: "growth",
    primaryQuestionAnswered: "Which contexts are most likely to generate meaningful tips?",
    detailRoute: "/reports/detail/tip-patterns",
    emptyStateCopy: "Need more tipped trips to establish pattern confidence.",
    status: "placeholder",
    supportsShare: true,
  },
  {
    id: "time-of-day-winners-losers",
    title: "Time-of-Day Winners / Losers",
    shortDescription: "Compare hourly windows by true net outcomes and target gaps.",
    category: "efficiency",
    primaryQuestionAnswered: "What hours usually outperform or underperform your targets?",
    detailRoute: "/reports/detail/time-of-day-winners-losers",
    emptyStateCopy: "Import trips across more time windows for winner/loser confidence.",
    status: "placeholder",
    supportsShare: false,
  },
  {
    id: "achievements",
    title: "Achievements",
    shortDescription: "Shareable best/worst records grounded in imported trip history.",
    category: "growth",
    primaryQuestionAnswered: "What standout records from your history are worth sharing?",
    detailRoute: "/reports/achievements",
    emptyStateCopy: "Import more history to unlock stronger and funnier records.",
    status: "placeholder",
    supportsShare: true,
  },
] as const;

export function getReportRegistryEntry(reportId: ReportType): ReportRegistryEntry {
  const found = REPORT_REGISTRY.find((entry) => entry.id === reportId);
  if (!found) {
    throw new Error(`Unknown report registry id: ${reportId}`);
  }
  return found;
}

export function getReportRoute(reportId: ReportType): string {
  return getReportRegistryEntry(reportId).detailRoute;
}
