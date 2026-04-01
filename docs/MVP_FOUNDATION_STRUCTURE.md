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
  engines/
    import/
      adapters.ts
  presentation/
    placeholderData.ts
    placeholderReports.ts
    placeholderAchievements.ts
    placeholderClaims.ts
    placeholderSettings.ts
    placeholderUpload.ts
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
docs/
  MVP_FOUNDATION_STRUCTURE.md
  SCREEN_SHELL_PLAN.md
  MVP_SCOPE_BOUNDARY.md
```

## Why this structure

- Keeps local schema and domain truth centralized.
- Uses registry-first contracts for report and achievement identity.
- Separates placeholder intelligence datasets by screen concern.
- Supports local-first receipt capture from camera and file upload paths.
