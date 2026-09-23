export function rankProperty(property, preferences = {}) {
  let score = 0;
  if (property.saved) score += 30;
  if ((property.beds ?? 0) >= (preferences.minBeds ?? 0)) score += 15;
  if (property.price && preferences.maxPrice && property.price <= preferences.maxPrice) score += 20;
  if (property.nearSchool) score += preferences.schoolPriority === false ? 5 : 15;
  if (property.kidFriendly) score += preferences.kidFriendlyPriority === false ? 5 : 15;
  if (property.status === "visited") score += 5;

  // Prefer listings that are actionable and corroborated by more than one source.
  if (property.address) score += 4;
  if (property.sourceUrl) score += 3;
  if (property.beds != null) score += 2;
  if (property.baths != null) score += 1;
  const sourceCount = property.metadata?.sources?.length || (property.source ? 1 : 0);
  score += Math.min(6, Math.max(0, sourceCount - 1) * 2);

  return score;
}

export function rankProperties(properties, preferences) {
  return [...properties].sort((a,b) => {
    const delta = rankProperty(b,preferences)-rankProperty(a,preferences);
    if (delta) return delta;
    const aUpdated = Date.parse(a.updatedAt || a.metadata?.listedAt || 0) || 0;
    const bUpdated = Date.parse(b.updatedAt || b.metadata?.listedAt || 0) || 0;
    return bUpdated - aUpdated;
  });
}
