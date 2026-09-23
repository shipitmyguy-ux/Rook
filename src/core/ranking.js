export function rankProperty(property, preferences = {}) {
  let score = 0;
  if (property.saved) score += 30;
  if ((property.beds ?? 0) >= (preferences.minBeds ?? 0)) score += 15;
  if (property.price && preferences.maxPrice && property.price <= preferences.maxPrice) score += 20;
  if (property.nearSchool) score += 15;
  if (property.kidFriendly) score += 15;
  if (property.status === "visited") score += 5;
  return score;
}

export function rankProperties(properties, preferences) {
  return [...properties].sort((a,b) => rankProperty(b,preferences)-rankProperty(a,preferences));
}
