const test = require("node:test");
const assert = require("node:assert/strict");
const { recomputeCoverageSummary, splitReviewSuggestions } = require("../manualReconciliation");

test("recompute coverage summary from linked records", () => {
  const summary = {
    eligibleEarningsTotal: 100,
    sequenceSuggestions: [
      { autoAccepted: false, manualConfirmed: false, matchConfidence: "medium", hasPaymentCandidate: true, hasLocationPath: true },
      { autoAccepted: false, manualConfirmed: true, matchConfidence: "medium", hasPaymentCandidate: true, hasLocationPath: true },
      { autoAccepted: false, manualConfirmed: false, matchConfidence: "review", hasPaymentCandidate: true, hasLocationPath: true },
    ],
  };
  const linkedRecords = [
    { paymentGroup: { financialTotal: 25 } },
    { paymentGroup: { financialTotal: 30 } },
  ];

  const result = recomputeCoverageSummary(summary, linkedRecords);
  assert.equal(result.linkedEarningsTotal, 55);
  assert.equal(result.earningsCoveragePercent, 55);
  assert.equal(result.earningsCoverageTier, "Needs review");
  assert.equal(result.sequenceQuickWinsCount, 1);
  assert.equal(result.geoLinkedTrips, 2);
});

test("split review suggestions into coverage vs history buckets", () => {
  const input = [
    { linkedTripId: "a", autoAccepted: false, manualConfirmed: false, hasPaymentCandidate: true, hasLocationPath: true },
    { linkedTripId: "b", autoAccepted: false, manualConfirmed: false, hasPaymentCandidate: false, hasLocationPath: true },
    { linkedTripId: "c", autoAccepted: true, manualConfirmed: false, hasPaymentCandidate: true, hasLocationPath: true },
    { linkedTripId: "d", autoAccepted: false, manualConfirmed: true, hasPaymentCandidate: true, hasLocationPath: true },
    { linkedTripId: "e", autoAccepted: false, manualConfirmed: false, hasPaymentCandidate: true, hasLocationPath: false },
  ];
  const result = splitReviewSuggestions(input);
  assert.equal(result.coverageSuggestions.length, 1);
  assert.equal(result.coverageSuggestions[0].linkedTripId, "a");
  assert.equal(result.historySuggestions.length, 1);
  assert.equal(result.historySuggestions[0].linkedTripId, "b");
  assert.equal(result.unresolved.length, 3);
});
