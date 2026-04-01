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

- Bottom nav: Home, Diary, Reports, Claims, Settings.
- Upload reachable from dashboard and reports CTA buttons (and available via direct route for empty-state hooks).
- Detailed Analysis is a drill-down from Reports cards using registry IDs.
- Achievements is inside Reports with its own route.
- Auth sits outside the tab shell.

## Shell Intent Guarantees

- Dashboard remains recommendation-first; no recent-trip feed.
- Smart Diary remains advisory and historical.
- Reports leads with intelligence cards after a compact upload/sync status card.
- Admin/record-keeping appears lower on Reports with local-first receipt records.
- Detailed Analysis uses correct-to date, basis note, confidence label, actionable insight, IF/THEN, comparison, takeaway.
- Claims & Fees remains recovery-focused with issue filters and claim-helper text.
- Achievements remains fun/shareable but grounded in imported-history truth.
