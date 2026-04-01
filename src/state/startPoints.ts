import { deriveUkOutwardCode, normalizeUkPostcode } from "../utils/postcodes";
import { StartPoint } from "./startPointTypes";

let points: StartPoint[] = [
  { id: "sp-default", label: "City Start", postcode: "BT1 1AA", outwardCode: "BT1", latitude: 54.6, longitude: -5.93 },
];

export async function listStartPoints(): Promise<StartPoint[]> {
  return points;
}

export async function addStartPoint(input: { postcode: string; label: string }): Promise<void> {
  const postcode = normalizeUkPostcode(input.postcode);
  points = [
    {
      id: `sp-${Date.now()}`,
      label: input.label || postcode,
      postcode,
      outwardCode: deriveUkOutwardCode(postcode),
      latitude: 54.6,
      longitude: -5.93,
    },
    ...points,
  ];
}

export async function updateStartPoint(id: string, input: { postcode: string; label: string }): Promise<void> {
  const postcode = normalizeUkPostcode(input.postcode);
  points = points.map((point) =>
    point.id === id
      ? {
          ...point,
          label: input.label || postcode,
          postcode,
          outwardCode: deriveUkOutwardCode(postcode),
        }
      : point,
  );
}

export async function removeStartPoint(id: string): Promise<void> {
  points = points.filter((point) => point.id !== id);
}