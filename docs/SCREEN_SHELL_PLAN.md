# Screen Shell Plan Mapped To HTML References

## Mapping

- `index.html` -> `app/(tabs)/home.tsx` + `src/screens/DashboardScreen.tsx`
- `diary.html` -> `app/(tabs)/diary.tsx` + `src/screens/SmartDiaryScreen.tsx`
- `reports.html` -> `app/(tabs)/reports.tsx` + `src/screens/ReportsScreen.tsx`
- `reports-detail.html` -> `app/reports/detail/[reportId].tsx` + `src/screens/DetailedAnalysisScreen.tsx`
- `bounties.html` -> `app/(tabs)/claims.tsx` + `src/screens/ClaimsFeesScreen.tsx`
- `upload.html` -> `app/upload.tsx` + `src/screens/UploadScreen.tsx`
- `settings.html` -> `app/(tabs)/settings.tsx` + `src/screens/SettingsScreen.tsx`
- Achievements extension -> `app/reports/achievements.tsx` + `src/screens/AchievementsScreen.tsx`
- Auth shell outside app nav -> `app/auth.tsx` + `src/screens/AuthScreen.tsx`

## Navigation Rules Implemented

- Bottom nav only: Home, Diary, Reports, Claims, Settings.
- Stray tab routes (`index`, `explore`) removed from tab exposure.
- Upload reachable from dashboard and reports CTA buttons.
- Detailed Analysis is a drill-down from Reports cards.
- Achievements is inside Reports with its own route.
- Auth sits outside the tab shell.

## Home Mode Split

- Online mode card order:
  1. Session Status
  2. Current Location Context
  3. Recommended Action
  4. Historical Context Guidance
  5. Comparable Context Signals
  6. Business Mileage Tracking
  7. Quick Actions
- Offline mode card order:
  1. Session Status
  2. Should I go online now?
  3. Upcoming Warnings
  4. Outstanding Actions
  5. Tax Progress
  6. Achievement Highlight
  7. Quick Actions

## Shell Intent Guarantees

- Dashboard remains recommendation-first; no recent-trip feed.
- Online guidance remains historical/comparative; no live earnings claims.
- Offline mode remains planning/review/admin focused.
- Settings treats start areas as postcode-first preferred starting points.
