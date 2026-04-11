const test = require("node:test");
const assert = require("node:assert/strict");
const { getCoverageTier } = require("../coverageTier");

test("coverage tier boundaries", () => {
  assert.equal(getCoverageTier(74.9), "Needs review");
  assert.equal(getCoverageTier(75), "Good");
  assert.equal(getCoverageTier(84.9), "Good");
  assert.equal(getCoverageTier(85), "Strong");
  assert.equal(getCoverageTier(94.9), "Strong");
  assert.equal(getCoverageTier(95), "Excellent");
});

