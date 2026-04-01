import { RecoverySummaryContract } from "../contracts/recovery";

export const placeholderClaims: RecoverySummaryContract = {
  totalEstimatedValue: 26.4,
  openItems: 3,
  issueBreakdown: [
    { type: "missing-surcharge", count: 1, estimatedValue: 7.5 },
    { type: "wait-time-anomaly", count: 1, estimatedValue: 8.9 },
    { type: "suspected-underpayment", count: 1, estimatedValue: 10.0 },
  ],
  leaks: [
    {
      type: "missing-surcharge",
      estimatedValue: 7.5,
      explanation: "Likely airport surcharge missing for late evening destination.",
      confidence: "MEDIUM",
      claimHelperText: "Request surcharge review with pickup/dropoff timestamps and fare breakdown.",
    },
    {
      type: "wait-time-anomaly",
      estimatedValue: 8.9,
      explanation: "Paid wait appears lower than expected wait for this pickup context.",
      confidence: "LOW",
      claimHelperText: "Ask support to verify waiting-time pay against logged timeline.",
    },
    {
      type: "suspected-underpayment",
      estimatedValue: 10.0,
      explanation: "Comparable route outcomes suggest probable fare shortfall.",
      confidence: "LOW",
      claimHelperText: "Submit route details and expected range for manual recalculation.",
    },
  ],
};
