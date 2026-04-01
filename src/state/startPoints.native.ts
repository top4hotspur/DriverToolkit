import { getDb } from "../db/client.native";
import { StartPoint } from "./startPointTypes";

const USER_ID = "local-user";

export async function listStartPoints(): Promise<StartPoint[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    label: string;
    postcode: string;
    latitude: number;
    longitude: number;
  }>(`
    SELECT
      id,
      display_name as label,
      area_code as postcode,
      center_lat as latitude,
      center_lng as longitude
    FROM start_areas
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [USER_ID]);

  return rows;
}

export async function addStartPoint(input: { postcode: string; label: string }): Promise<void> {
  const db = await getDb();
  const postcode = normalizePostcode(input.postcode);
  const coords = approximatePostcodeCoords(postcode);
  const id = `sp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  await db.runAsync(
    `
      INSERT INTO start_areas (
        id, user_id, area_code, display_name, center_lat, center_lng, radius_miles, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [id, USER_ID, postcode, input.label.trim() || postcode, coords.lat, coords.lng, 1, new Date().toISOString()],
  );
}

export async function updateStartPoint(id: string, input: { postcode: string; label: string }): Promise<void> {
  const db = await getDb();
  const postcode = normalizePostcode(input.postcode);
  const coords = approximatePostcodeCoords(postcode);

  await db.runAsync(
    `
      UPDATE start_areas
      SET area_code = ?, display_name = ?, center_lat = ?, center_lng = ?
      WHERE id = ?
    `,
    [postcode, input.label.trim() || postcode, coords.lat, coords.lng, id],
  );
}

export async function removeStartPoint(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM start_areas WHERE id = ?`, [id]);
}

function normalizePostcode(postcode: string): string {
  return postcode.trim().toUpperCase().replace(/\s+/g, "");
}

function approximatePostcodeCoords(postcode: string): { lat: number; lng: number } {
  const core = postcode.startsWith("BT") ? postcode : `BT1`;
  const district = Number(core.replace(/[^0-9]/g, "").slice(0, 2)) || 1;

  return {
    lat: 54.55 + district * 0.01,
    lng: -6.0 + district * 0.01,
  };
}
