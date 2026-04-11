const ROLLOUT_RULES = [
  {
    ruleKey: "uk-ni-default",
    description: "Northern Ireland default rollout",
    when: {
      country: "GB",
      regionKey: "uk-ni",
    },
    enableProviders: ["translink", "sportsdb", "ticketmaster"],
    disableProviders: [],
  },
  {
    ruleKey: "us-chicago-default",
    description: "Chicago initial rollout scaffold",
    when: {
      country: "US",
      regionKey: "us-il-chicago",
    },
    enableProviders: [],
    disableProviders: [],
  },
];

function resolveActiveProvidersForLocation(args) {
  const country = String(args?.country ?? "").toUpperCase();
  const regionKey = String(args?.regionKey ?? "").toLowerCase();
  const city = String(args?.city ?? "").toLowerCase();

  const matchingRules = ROLLOUT_RULES.filter((rule) => {
    const countryMatch = !rule.when.country || rule.when.country.toUpperCase() === country;
    const regionMatch = !rule.when.regionKey || rule.when.regionKey.toLowerCase() === regionKey;
    const cityMatch = !rule.when.city || rule.when.city.toLowerCase() === city;
    return countryMatch && regionMatch && cityMatch;
  });

  const enabled = new Set();
  const disabled = new Set();
  for (const rule of matchingRules) {
    for (const providerKey of rule.enableProviders ?? []) enabled.add(providerKey);
    for (const providerKey of rule.disableProviders ?? []) disabled.add(providerKey);
  }
  for (const key of disabled) enabled.delete(key);

  return {
    activeProviderKeys: Array.from(enabled),
    matchedRules: matchingRules.map((rule) => rule.ruleKey),
  };
}

function listRolloutRules() {
  return [...ROLLOUT_RULES];
}

module.exports = {
  listRolloutRules,
  resolveActiveProvidersForLocation,
};
