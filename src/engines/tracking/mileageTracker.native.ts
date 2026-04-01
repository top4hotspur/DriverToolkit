import * as Location from "expo-location";
import { getDb } from "../../db/client.native";
import { BusinessMileageSummary, TrackingStartResult, TrackingStopResult } from "../../contracts/tracking";

let locationSubscription: Location.LocationSubscription | null = null;
let activeSessionId: string | null = null;
let lastCoords: Location.LocationObjectCoords | null = null;

export async function startBusinessMileageTracking(currentAreaLabel: string | null): Promise<TrackingStartResult> {
  if (locationSubscription && activeSessionId) {
    return {
      ok: true,
      summary: await getBusinessMileageSummary(),
      warning: "Tracking already active.",
    };
  }

  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") {
    return {
      ok: false,
      summary: await getBusinessMileageSummary(),
      warning: "Location permission is required to track business mileage.",
    };
  }

  const sessionId = `mile_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  activeSessionId = sessionId;
  lastCoords = null;

  const now = new Date().toISOString();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT INTO mileage_sessions (
        id, started_at, stopped_at, started_area_label,
        stopped_area_label, total_miles, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [sessionId, now, null, currentAreaLabel, null, 0, 1, now, now],
  );

  locationSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50,
      timeInterval: 20_000,
    },
    async (position) => {
      if (!activeSessionId) {
        return;
      }

      if (!lastCoords) {
        lastCoords = position.coords;
        return;
      }

      const meters = haversineMeters(lastCoords.latitude, lastCoords.longitude, position.coords.latitude, position.coords.longitude);
      lastCoords = position.coords;
      const miles = meters * 0.000621371;

      if (!Number.isFinite(miles) || miles <= 0) {
        return;
      }

      const dbInner = await getDb();
      await dbInner.runAsync(
        `
          UPDATE mileage_sessions
          SET total_miles = total_miles + ?, updated_at = ?
          WHERE id = ?
        `,
        [miles, new Date().toISOString(), activeSessionId],
      );
    },
  );

  return {
    ok: true,
    summary: await getBusinessMileageSummary(),
  };
}

export async function stopBusinessMileageTracking(currentAreaLabel: string | null): Promise<TrackingStopResult> {
  if (locationSubscription) {
    locationSubscription.remove();
    locationSubscription = null;
  }

  const stoppingSessionId = activeSessionId;
  activeSessionId = null;
  lastCoords = null;

  if (stoppingSessionId) {
    const db = await getDb();
    await db.runAsync(
      `
        UPDATE mileage_sessions
        SET stopped_at = ?, stopped_area_label = ?, is_active = 0, updated_at = ?
        WHERE id = ?
      `,
      [new Date().toISOString(), currentAreaLabel, new Date().toISOString(), stoppingSessionId],
    );
  }

  return {
    ok: true,
    summary: await getBusinessMileageSummary(),
  };
}

export async function getBusinessMileageSummary(): Promise<BusinessMileageSummary> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    activeSessionId: string | null;
    trackedBusinessMiles: number | null;
    trackingStartedAt: string | null;
    trackingStoppedAt: string | null;
    activeFlag: number | null;
  }>(`
    SELECT
      id as activeSessionId,
      total_miles as trackedBusinessMiles,
      started_at as trackingStartedAt,
      stopped_at as trackingStoppedAt,
      is_active as activeFlag
    FROM mileage_sessions
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return {
    active: (row?.activeFlag ?? 0) === 1,
    activeSessionId: row?.activeSessionId ?? null,
    trackedBusinessMiles: round2(row?.trackedBusinessMiles ?? 0),
    trackingStartedAt: row?.trackingStartedAt ?? null,
    trackingStoppedAt: row?.trackingStoppedAt ?? null,
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

