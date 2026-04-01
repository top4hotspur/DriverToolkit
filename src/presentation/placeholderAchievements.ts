import { AchievementCardContract, AchievementsScreenContract } from "../contracts/achievements";
import { ACHIEVEMENT_REGISTRY } from "../contracts/achievementRegistry";
import { NewAchievementDetectionResult } from "../contracts/newAchievements";

const cardValues: Record<AchievementCardContract["type"], Omit<AchievementCardContract, "type" | "title" | "shareCtaLabel">> = {
  "best-trip-per-hour": {
    metricValue: "£42.80/hr",
    occurredAt: "2026-03-15 18:42",
    areaOrContext: "City Centre",
    oneLineExplanation: "Fast pickup, short wait, strong fare chain.",
    confidence: "HIGH",
    sampleSize: 55,
    shareText: "Best £/hr trip from my history: £42.80/hr",
    shareTarget: "whatsapp",
  },
  "worst-trip-per-hour": {
    metricValue: "£7.10/hr",
    occurredAt: "2026-03-08 22:05",
    areaOrContext: "Airport Queue",
    oneLineExplanation: "Long idle time and heavy return-mile penalty.",
    confidence: "MEDIUM",
    sampleSize: 55,
    shareText: "Worst value trip: airport queue disaster",
    shareTarget: "whatsapp",
  },
  "best-trip-per-mile": {
    metricValue: "£6.40/mile",
    occurredAt: "2026-03-12 08:10",
    areaOrContext: "Station Corridor",
    oneLineExplanation: "Short route with minimal dead miles.",
    confidence: "HIGH",
    sampleSize: 55,
    shareText: "Best £/mile trip from my history: £6.40/mile",
    shareTarget: "whatsapp",
  },
  "worst-trip-per-mile": {
    metricValue: "£0.88/mile",
    occurredAt: "2026-03-09 21:15",
    areaOrContext: "Airport Return",
    oneLineExplanation: "Dead-mile penalty dominated total outcome.",
    confidence: "MEDIUM",
    sampleSize: 55,
    shareText: "Worst £/mile trip: airport return pain",
    shareTarget: "whatsapp",
  },
  "best-tip": {
    metricValue: "£11.40",
    occurredAt: "2026-03-14 23:12",
    areaOrContext: "Night Centre",
    oneLineExplanation: "Largest tip on a single imported trip.",
    confidence: "HIGH",
    sampleSize: 55,
    shareText: "Biggest tip: £11.40",
    shareTarget: "whatsapp",
  },
  "worst-tip": {
    metricValue: "£0.00",
    occurredAt: "Multiple nights",
    areaOrContext: "Airport Queue",
    oneLineExplanation: "No-tip streak appears in long queue contexts.",
    confidence: "HIGH",
    sampleSize: 55,
    shareText: "Worst tip run: airport queue zero-tip streak",
    shareTarget: "whatsapp",
  },
  "best-tip-per-mile": {
    metricValue: "£2.30/mile",
    occurredAt: "2026-03-11 19:08",
    areaOrContext: "Riverside",
    oneLineExplanation: "High gratuity on a short-distance trip.",
    confidence: "MEDIUM",
    sampleSize: 55,
    shareText: "Best tip per mile from my history: £2.30/mile",
    shareTarget: "whatsapp",
  },
  "worst-tip-per-mile": {
    metricValue: "£0.00/mile",
    occurredAt: "Multiple",
    areaOrContext: "Outer Ring",
    oneLineExplanation: "Long no-tip rides drag this metric down.",
    confidence: "MEDIUM",
    sampleSize: 55,
    shareText: "Worst tip per mile streak: £0.00/mile",
    shareTarget: "whatsapp",
  },
  "best-tip-per-hour": {
    metricValue: "£18.20/hr",
    occurredAt: "2026-03-07 20:02",
    areaOrContext: "Arena Pickup",
    oneLineExplanation: "Large tip delivered in a short service window.",
    confidence: "LOW",
    sampleSize: 55,
    shareText: "Best tip per hour from my history: £18.20/hr",
    shareTarget: "whatsapp",
  },
  "worst-tip-per-hour": {
    metricValue: "£0.00/hr",
    occurredAt: "Multiple",
    areaOrContext: "Airport Queue",
    oneLineExplanation: "Extended waits with no tip sink this score.",
    confidence: "MEDIUM",
    sampleSize: 55,
    shareText: "Worst tip per hour pattern: still zero in queue traps",
    shareTarget: "whatsapp",
  },
};

export const placeholderAchievements: AchievementsScreenContract = {
  generatedAt: new Date().toISOString(),
  basisLabel: "Based on last 90 days",
  cards: ACHIEVEMENT_REGISTRY.map((entry) => ({
    type: entry.id,
    title: entry.title,
    shareCtaLabel: "Share Highlight",
    ...cardValues[entry.id],
  })),
};

export function getOfflineContextualAchievementHighlight(args: {
  now: Date;
  recentNewAchievements: NewAchievementDetectionResult | null;
}): AchievementCardContract {
  if (args.recentNewAchievements?.hasNewAchievements) {
    const first = args.recentNewAchievements.events[0];
    const match = placeholderAchievements.cards.find((card) => card.type === first.achievementId);
    if (match) {
      return match;
    }
  }

  const day = args.now.getDay();
  const hour = args.now.getHours();

  if (day === 5 || day === 6) {
    return findCard("best-tip");
  }

  if (hour >= 18 && hour <= 22) {
    return findCard("best-trip-per-hour");
  }

  return findCard("best-trip-per-mile");
}

function findCard(type: AchievementCardContract["type"]): AchievementCardContract {
  const found = placeholderAchievements.cards.find((card) => card.type === type);
  if (!found) {
    return placeholderAchievements.cards[0];
  }
  return found;
}

