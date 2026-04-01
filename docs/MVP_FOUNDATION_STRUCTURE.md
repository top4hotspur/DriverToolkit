# Driver Toolkit MVP Foundation Structure Proposal

## Proposed Repo Shape

```
app/
  (tabs)/
    _layout.tsx
    home.tsx
    diary.tsx
    reports.tsx
    claims.tsx
    settings.tsx
  reports/
    achievements.tsx
    detail/
      [reportId].tsx
  _layout.tsx
  index.tsx
  upload.tsx
  auth.tsx
src/
  contracts/
    recommendations.ts
    recovery.ts
    reports.ts
    achievements.ts
    reportRegistry.ts
    achievementRegistry.ts
    tracking.ts
    tasks.ts
    goOnlineNow.ts
    newAchievements.ts
  db/
    client.native.ts
    client.ts
    localSchema.ts
    schema.native.ts
    schema.ts
  domain/
    types.ts
    formulas.ts
    confidence.ts
    importTypes.ts
  engines/
    import/
      adapters.ts
      detectProvider.ts
      parseUberExport.ts
      normalizeUberTrip.ts
      importPersistence.ts
      importUberPrivacyZip.ts
    tracking/
      mileageTracker.native.ts
      mileageTracker.ts
  state/
    sessionTypes.ts
    sessionState.native.ts
    sessionState.ts
    settingsTypes.ts
    settingsState.native.ts
    settingsState.ts
  presentation/
    placeholderData.ts
    placeholderReports.ts
    placeholderAchievements.ts
    placeholderClaims.ts
    placeholderSettings.ts
    placeholderUpload.ts
    goOnlineNow.ts
    offlineTasks.ts
    newAchievements.ts
  screens/
    DashboardScreen.tsx
    SmartDiaryScreen.tsx
    ReportsScreen.tsx
    ClaimsFeesScreen.tsx
    SettingsScreen.tsx
    UploadScreen.tsx
    DetailedAnalysisScreen.tsx
    AchievementsScreen.tsx
    AuthScreen.tsx
    ui.tsx
  utils/
    csv.ts
    dateBuckets.ts
    dueDates.ts
    format.ts
docs/
  MVP_FOUNDATION_STRUCTURE.md
  SCREEN_SHELL_PLAN.md
  MVP_SCOPE_BOUNDARY.md
```

## Why this structure

- Keeps local schema and domain truth centralized.
- Uses registry-first contracts for report and achievement identity.
- Separates session/tracking state from screen composition.
- Supports local-only import, normalization, and business mileage tracking.
