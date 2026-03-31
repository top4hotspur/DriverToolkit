# Codex Brief — Driver Toolkit MVP Foundation

You are building the foundation of Driver Toolkit.

## 1. Product truth

Driver Toolkit is a **decision-support app for rideshare drivers** built from:

* delayed platform privacy-export data
* local costs and targets
* lightweight external diary/event context

It is NOT:

* a live earnings tracker
* a live dispatch mirror
* a fleet-density tool
* a recent-activity dashboard

Do not build features that imply fake real-time truth.

## 2. Architecture rules

### Core engines

Build around:

1. Import Engine
2. Truth Engine
3. Decision Engine
4. Recovery Engine

### Local-first rules

* Local SQLite is the source of truth for personal data
* No persistent cloud DB for raw user trip history
* All recommendation computation happens locally
* Cloud is only for auth, subscriptions, and daily diary/event feed artifacts

### Cost rules

Keep AWS extremely cheap.
Do not introduce:

* per-user cloud compute
* realtime infrastructure
* frequent mobile polling to external APIs
* heavyweight backend dependencies

## 3. Technology stack

Use:

* React Native / Expo
* expo-router
* expo-sqlite
* expo-file-system
* JSZip
* PapaParse
* expo-location

Cloud assumptions for later only:

* Supabase Auth or Firebase Auth
* AWS Lambda + EventBridge + S3 + CloudFront for daily diary feeds

## 4. Visual direction

Treat the uploaded HTML files as the visual and UX reference standard.

Use them as guidance for layout, tone, component hierarchy, and screen purpose.

Priority reference screens:

* Dashboard = strongest screen
* Smart Diary = strong
* Claims / Earnings Leaks = strong
* Upload = must preserve both why + how
* Settings = needs to function as decision-engine control panel
* Reports = must become intelligence-first
* Detailed Analysis = expanded actionable intelligence
* Add new Achievements page in same visual language

Do not invent unrelated UI patterns.

## 5. Current implementation goal

Do NOT build the full app.
Do NOT build cloud features yet.
Do NOT build live integrations yet.

Build the foundation only.

### Immediate deliverables

1. Lock local SQLite schema
2. Lock TypeScript domain types
3. Lock provider-neutral import interfaces
4. Build pure metric calculation module
5. Build confidence calculation module
6. Define recommendation output contracts
7. Define recovery / earnings leak contracts
8. Build screen shells aligned to the reference HTML

## 6. Required local tables

Implement schema support for:

* users_local
* provider_imports
* trips_raw
* trips_normalized
* expenses
* vehicle_cost_history
* decision_targets
* start_areas
* geofences
* diary_events_cached
* recommendation_snapshots
* earnings_leaks

## 7. Canonical metrics layer

All screens must derive from the same canonical truth model:

* earnings_total
* waiting_time_minutes
* trip_distance_miles
* dead_miles
* fuel_cost
* maintenance_cost
* true_net
* true_net_per_hour
* true_net_per_mile
* return_trip_penalty
* target_gap_hourly
* target_gap_mile

Do not create screen-specific duplicate logic.

## 8. Provider-neutral import model

Create import adapter interfaces for:

* parseUberExport(...)
* parseBoltExport(...)
* parseLyftExport(...)

All adapters must map into a shared normalized intermediate trip shape.

Uber is first, but the core model must not be Uber-specific.

## 9. Recommendation outputs that must be supported

Define contracts for:

### Recommended Action

Outputs:

* stay / reposition / avoid / short-wait-only
* confidence
* sample size
* plain-English reason

### Have I been here before?

Outputs:

* avg wait
* avg first fare
* next 90-min outcome
* follow-on rate
* confidence
* sample size

### What usually happens next?

Outputs:

* likely next job type
* likely wait time
* expected 60/90-min yield
* confidence
* sample size

### Bad Bet engine

Outputs per area:

* avg true net per hour
* avg true net per mile
* dead mile tendency
* suggested minimum accept fare
* trend

### Journey Regret detector

Outputs:

* regret score
* common theme
* suggested threshold rule

### Earnings Leak detector

Outputs:

* type
* estimated value
* explanation
* claim-helper text

### Achievements

Add support for:

* best/worst trip by £/hour
* best/worst trip by £/mile
* best/worst tip
* best/worst tip per mile
* best/worst tip per hour

Achievements must be historical, shareable, and suitable for WhatsApp sharing.

## 10. Confidence rules

Implement first-pass confidence rules:

* High: >= 20 comparable observations and stable variance
* Medium: 8–19 observations or moderate variance
* Low: 3–7 observations or weak comparability
* No recommendation: < 3 observations

## 11. Time-window rules

Implement adaptive windows:

* default = 90 days
* tighten to 30 days when data is strong
* expand to 6–12 months when sparse

Store and expose:

* actual basis window used
* sample size

## 12. Screen rules

### Dashboard

Must remain decision-first.
Do not turn it into a recent-trip dashboard.

### Upload

Must explain why upload matters, not just how to upload.

### Settings

Must control targets, start areas, and vehicle assumptions.

### Reports

Must lead with intelligence cards, not admin-first content.

### Achievements

Must be clearly historical and easily shareable.

## 13. Build order

Implement in this order:

1. schema
2. types
3. import interfaces
4. formulas
5. confidence module
6. recommendation contracts
7. recovery contracts
8. screen shells

## 14. Output style

Keep implementation:

* simple
* modular
* typed
* local-first
* cheap to run
* easy to extend

Avoid speculative complexity.
Avoid backend-heavy architecture.
Avoid drift from the locked product definition.
