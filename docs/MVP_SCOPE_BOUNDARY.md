# MVP Scope Boundary (Now vs Later)

## MVP Now (This Pass)

- Local SQLite schema for required tables.
- Strong TypeScript domain types and contracts.
- Provider-neutral import interfaces and local Uber ZIP import.
- Local session mode state (`online`/`offline`) with clear home split.
- GPS business mileage tracking active only in online mode.
- One-shot `Should I go online now?` check with safe fallbacks.
- Postcode-based preferred starting points in Settings.
- Actionable, stateful outstanding actions with completion and recurrence behavior.
- Countdown warnings shown only when relevant or when setup is missing.
- Centralized GBP formatting and evidence wording refinements.

## Later (Explicitly Deferred)

- Live earnings/profit reporting.
- Cloud receipt/document sync.
- Full report engine rewrite and full real-data wiring across every report.
- Realtime dispatch/demand features.
