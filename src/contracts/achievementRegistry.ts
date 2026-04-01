export type AchievementRegistryId =
  | "best-trip-per-hour"
  | "worst-trip-per-hour"
  | "best-trip-per-mile"
  | "worst-trip-per-mile"
  | "best-tip"
  | "worst-tip"
  | "best-tip-per-mile"
  | "worst-tip-per-mile"
  | "best-tip-per-hour"
  | "worst-tip-per-hour";

export type AchievementTone = "brag" | "banter" | "ouch";

export interface AchievementRegistryEntry {
  id: AchievementRegistryId;
  title: string;
  description: string;
  metricLabel: string;
  supportsShare: true;
  shareChannelPriority: ["whatsapp"];
  tone: AchievementTone;
}

export const ACHIEVEMENT_REGISTRY: ReadonlyArray<AchievementRegistryEntry> = [
  {
    id: "best-trip-per-hour",
    title: "Best Trip by £/Hour",
    description: "Your single strongest hourly-value trip from imported history.",
    metricLabel: "£/hour",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "brag",
  },
  {
    id: "worst-trip-per-hour",
    title: "Worst Trip by £/Hour",
    description: "The trip with the weakest hourly value once costs are included.",
    metricLabel: "£/hour",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "ouch",
  },
  {
    id: "best-trip-per-mile",
    title: "Best Trip by £/Mile",
    description: "Your highest-value trip per mile from real imported history.",
    metricLabel: "£/mile",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "brag",
  },
  {
    id: "worst-trip-per-mile",
    title: "Worst Trip by £/Mile",
    description: "Your lowest-value trip per mile with dead miles and costs considered.",
    metricLabel: "£/mile",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "ouch",
  },
  {
    id: "best-tip",
    title: "Best Tip",
    description: "Largest single-trip tip recorded in your imported data.",
    metricLabel: "tip",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "brag",
  },
  {
    id: "worst-tip",
    title: "Worst Tip",
    description: "Lowest single-trip tip outcome from your imported history.",
    metricLabel: "tip",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "banter",
  },
  {
    id: "best-tip-per-mile",
    title: "Best Tip per Mile",
    description: "Trip where gratuity density per mile was highest.",
    metricLabel: "tip per mile",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "brag",
  },
  {
    id: "worst-tip-per-mile",
    title: "Worst Tip per Mile",
    description: "Trip where tip density per mile was weakest.",
    metricLabel: "tip per mile",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "banter",
  },
  {
    id: "best-tip-per-hour",
    title: "Best Tip per Hour",
    description: "Highest gratuity intensity per active hour.",
    metricLabel: "tip per hour",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "brag",
  },
  {
    id: "worst-tip-per-hour",
    title: "Worst Tip per Hour",
    description: "Lowest gratuity intensity per active hour.",
    metricLabel: "tip per hour",
    supportsShare: true,
    shareChannelPriority: ["whatsapp"],
    tone: "ouch",
  },
] as const;

export function getAchievementRegistryEntry(id: AchievementRegistryId): AchievementRegistryEntry {
  const found = ACHIEVEMENT_REGISTRY.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown achievement registry id: ${id}`);
  }
  return found;
}
