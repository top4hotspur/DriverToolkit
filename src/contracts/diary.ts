export type DiarySourceAnchorType = "favourite" | "airport" | "station" | "venue";

export interface DiarySourceAnchor {
  id: string;
  label: string;
  type: DiarySourceAnchorType;
  source: "favourite" | "seeded";
  latitude: number;
  longitude: number;
  relatedFavouriteId?: string | null;
}

export interface DiaryDay {
  dateIso: string;
  dayLabel: string;
  selectorLabel: string;
  isToday: boolean;
  isTomorrow: boolean;
}

export interface WeatherAnomaly {
  id: string;
  type: "weather";
  severity: "info" | "warning" | "high";
  areaLabel: string;
  startsAt: string;
  endsAt: string;
  message: string;
}

export interface TransportDisruptionAnomaly {
  id: string;
  type: "transport-disruption";
  severity: "info" | "warning" | "high";
  networkLabel: string;
  startsAt: string;
  endsAt: string;
  message: string;
}

export interface AirportArrivalAnomaly {
  id: string;
  type: "airport-arrival";
  severity: "info" | "warning" | "high";
  airportLabel: string;
  startsAt: string;
  endsAt: string;
  expectedArrivals: number;
  delayedArrivals?: Array<{ serviceId: string; delayMinutes: number }>;
  message: string;
}

export type DayAnomaly = WeatherAnomaly | TransportDisruptionAnomaly | AirportArrivalAnomaly;

export interface OpportunityWindow {
  id: string;
  startsAt: string;
  endsAt: string;
  anchorId: string;
  anchorLabel: string;
  anchorType: DiarySourceAnchorType;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  detail: string;
}

export interface DiaryDayPlan {
  day: DiaryDay;
  anomalies: DayAnomaly[];
  opportunities: OpportunityWindow[];
}

export interface DiaryPlannerOutput {
  generatedAt: string;
  basisLabel: string;
  sourceAnchors: DiarySourceAnchor[];
  days: DiaryDayPlan[];
}
