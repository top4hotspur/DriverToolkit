import { TargetSettings } from "./targetTypes";

let targets: TargetSettings = {
  targetHourly: 18,
  targetPerMile: 1.2,
};

export async function getTargetSettings(): Promise<TargetSettings> {
  return targets;
}

export async function saveTargetSettings(next: TargetSettings): Promise<void> {
  targets = next;
}
