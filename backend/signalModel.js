function toNormalizedSignal(input) {
  const lat = toFiniteNumberOrNull(input.location?.lat);
  const lng = toFiniteNumberOrNull(input.location?.lng);
  return {
    id: String(input.id),
    provider: input.provider ? String(input.provider) : String(input.providerKey ?? "system"),
    providerKey: String(input.providerKey ?? "system"),
    category: input.category ? String(input.category) : null,
    sportType: input.sportType ? String(input.sportType) : null,
    competition: input.competition ? String(input.competition) : null,
    regionKey: String(input.regionKey ?? "global"),
    signalType: String(input.signalType ?? "normal"),
    title: String(input.title ?? "Signal"),
    subtitle: String(input.subtitle ?? ""),
    description: String(input.description ?? ""),
    severity: String(input.severity ?? "info"),
    startsAt: String(input.startsAt),
    endsAt: input.endsAt ? String(input.endsAt) : null,
    localTimeLabel: input.localTimeLabel ? String(input.localTimeLabel) : null,
    expectedIntensity: input.expectedIntensity ? String(input.expectedIntensity) : null,
    location: {
      locationId: input.location?.locationId ? String(input.location.locationId) : null,
      name: input.location?.name ? String(input.location.name) : null,
      postcode: input.location?.postcode ? String(input.location.postcode) : null,
      lat,
      lng,
      city: input.location?.city ? String(input.location.city) : null,
    },
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  toNormalizedSignal,
};
