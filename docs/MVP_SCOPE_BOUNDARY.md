# MVP Scope Boundary (Now vs Later)

## MVP Now (This Pass)

- Local SQLite schema for required tables.
- Strong TypeScript domain types and contracts.
- Provider-neutral import adapter interfaces (`parseUberExport`, `parseBoltExport`, `parseLyftExport`).
- Local Uber ZIP import pipeline.
- Canonical first-pass truth metric persistence.
- Recommendation, recovery, reports, and achievements output contracts.
- Report registry and achievements registry as source-of-truth metadata layers.
- Session mode architecture (`online`/`offline`) persisted locally.
- GPS business mileage tracking active only in online mode.
- Home screen split by session mode with offline planning blocks.
- `Should I go online now?` comparative historical decision contract and placeholder logic.
- Settings extensions for tax/compliance/radius controls.
- Local-first new-achievement detection hooks after import.

## Later (Explicitly Deferred)

- Real parser implementations for Bolt/Lyft files.
- Full truth-engine enrichment jobs (geofencing, advanced area tagging, richer comparability scoring).
- Fully data-driven decision engine replacing placeholders.
- Cloud receipt/document backup or any automatic upload mechanism.
- Auth/subscription cloud integrations.
- Any realtime/live dashboards, dispatch mirroring, or polling infra.
