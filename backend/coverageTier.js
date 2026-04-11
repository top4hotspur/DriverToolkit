function getCoverageTier(coveragePercent) {
  if (coveragePercent >= 95) {
    return "Excellent";
  }
  if (coveragePercent >= 85) {
    return "Strong";
  }
  if (coveragePercent >= 75) {
    return "Good";
  }
  return "Needs review";
}

module.exports = {
  getCoverageTier,
};

