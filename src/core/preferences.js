const KEY = "rook.preferences.v1";

export const defaultPreferences = Object.freeze({
  location: "Fort Collins, CO",
  radiusMiles: 15,
  minBeds: 2,
  maxPrice: 2800,
  propertyTypes: ["apartment", "townhome", "house"],
  excludeIncomeRestricted: true,
  excludeMobileHomes: true,
  kidFriendlyPriority: true,
  schoolPriority: true
});

export function normalizePreferences(value = {}) {
  const types = Array.isArray(value.propertyTypes) ? value.propertyTypes.filter(Boolean) : defaultPreferences.propertyTypes;
  return {
    ...defaultPreferences,
    ...value,
    location: String(value.location || defaultPreferences.location).trim(),
    radiusMiles: Math.max(1, Number(value.radiusMiles) || defaultPreferences.radiusMiles),
    minBeds: Math.max(0, Number(value.minBeds) || 0),
    maxPrice: Number(value.maxPrice) > 0 ? Number(value.maxPrice) : null,
    propertyTypes: Array.isArray(value.propertyTypes) ? [...new Set(types)] : [...defaultPreferences.propertyTypes],
    excludeIncomeRestricted: value.excludeIncomeRestricted !== false,
    excludeMobileHomes: value.excludeMobileHomes !== false,
    kidFriendlyPriority: value.kidFriendlyPriority !== false,
    schoolPriority: value.schoolPriority !== false
  };
}
export function loadPreferences() {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return { ...defaultPreferences, propertyTypes:[...defaultPreferences.propertyTypes] }; }
}
export function savePreferences(value) {
  localStorage.setItem(KEY, JSON.stringify(normalizePreferences(value)));
}
