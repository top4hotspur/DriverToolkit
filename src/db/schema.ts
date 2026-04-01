import { getLocalSchemaStatements } from "./localSchema";

export async function initDatabase(): Promise<void> {
  return;
}

export function getSchemaPreview(): string[] {
  return getLocalSchemaStatements();
}
