const { getCoverageTier } = require("./coverageTier");

function splitReviewSuggestions(suggestions) {
  const safe = Array.isArray(suggestions) ? suggestions : [];
  const unresolved = safe.filter((item) => !item.autoAccepted && !item.manualConfirmed);
  const coverageSuggestions = unresolved.filter(
    (item) => item.hasPaymentCandidate && item.hasLocationPath,
  );
  const historySuggestions = unresolved.filter((item) => !item.hasPaymentCandidate);
  return { coverageSuggestions, historySuggestions, unresolved };
}

function recomputeCoverageSummary(summary, linkedRecords) {
  const safeRecords = Array.isArray(linkedRecords) ? linkedRecords : [];
  const linkedEarningsTotal =
    Math.round(
      safeRecords.reduce((sum, record) => {
        const value = Number.parseFloat(
          String(record?.paymentGroup?.financialTotal ?? 0),
        );
        return sum + (Number.isNaN(value) ? 0 : value);
      }, 0) * 100,
    ) / 100;
  const eligible = Number.parseFloat(String(summary?.eligibleEarningsTotal ?? 0));
  const safeEligible = Number.isNaN(eligible) ? 0 : eligible;
  const earningsCoveragePercent =
    safeEligible > 0
      ? Math.round((linkedEarningsTotal / safeEligible) * 1000) / 10
      : 0;
  const earningsCoverageTier = getCoverageTier(earningsCoveragePercent);
  const reviewSuggestions = Array.isArray(summary?.reviewSuggestions)
    ? summary.reviewSuggestions
    : Array.isArray(summary?.sequenceSuggestions)
      ? summary.sequenceSuggestions
    : [];
  const { coverageSuggestions, historySuggestions } =
    splitReviewSuggestions(reviewSuggestions);
  const sequenceQuickWinsCount = coverageSuggestions.filter(
    (item) => item.matchConfidence !== "review",
  ).length;

  return {
    ...summary,
    linkedEarningsTotal,
    earningsCoveragePercent,
    earningsCoverageTier,
    sequenceQuickWinsCount,
    reviewSuggestions,
    coverageSuggestions,
    historySuggestions,
    geoLinkedTrips: safeRecords.length,
    groupedTripsMatchedToPayments: safeRecords.length,
  };
}

module.exports = {
  recomputeCoverageSummary,
  splitReviewSuggestions,
};
