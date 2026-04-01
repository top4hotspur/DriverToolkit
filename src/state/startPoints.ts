import { StartPoint } from "./startPointTypes";

let points: StartPoint[] = [
  { id: "sp-default", label: "City Start", postcode: "BT1", latitude: 54.6, longitude: -5.93 },
];

export async function listStartPoints(): Promise<StartPoint[]> {
  return points;
}

export async function addStartPoint(input: { postcode: string; label: string }): Promise<void> {
  points = [
    {
      id: `sp-${Date.now()}`,
      label: input.label || input.postcode,
      postcode: input.postcode.toUpperCase(),
      latitude: 54.6,
      longitude: -5.93,
    },
    ...points,
  ];
}

export async function updateStartPoint(id: string, input: { postcode: string; label: string }): Promise<void> {
  points = points.map((point) =>
    point.id === id
      ? {
          ...point,
          label: input.label || input.postcode,
          postcode: input.postcode.toUpperCase(),
        }
      : point,
  );
}

export async function removeStartPoint(id: string): Promise<void> {
  points = points.filter((point) => point.id !== id);
}
