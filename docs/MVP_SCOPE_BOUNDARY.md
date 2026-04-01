# MVP Scope Boundary (Now vs Later)

## MVP Now (This Pass)

- Local SQLite schema for required tables.
- Strong TypeScript domain types and contracts.
- Provider-neutral import adapter interfaces (`parseUberExport`, `parseBoltExport`, `parseLyftExport`).
- Canonical metric calculator module.
- Confidence and adaptive-window module.
- Recommendation, recovery, reports, and achievements output contracts.
- Report registry and achievements registry as source-of-truth metadata layers.
- 8 surface screen shells wired to typed placeholder intelligence data.
- Reports intelligence-first layout with compact upload/sync status at top.
- Local-first receipt input model for both camera capture and file upload metadata.
- Navigation architecture with reports drill-down and achievements route.

## Later (Explicitly Deferred)

- Real parser implementations for Uber/Bolt/Lyft files.
- Real import pipeline wiring from file intake to normalized persistence.
- Full truth-engine enrichment jobs (geofencing, bucketing, area tagging).
- Decision engine runtime selection and snapshot generation.
- Recovery detection algorithms over real imported rows.
- Cloud receipt/document backup or any automatic upload mechanism.
- Auth/subscription cloud integrations.
- Any realtime/live dashboards, dispatch mirroring, or polling infra.
