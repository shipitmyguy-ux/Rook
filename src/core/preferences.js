const KEY = "rook.preferences.v1";

export const defaultPreferences = Object.freeze({
  minBeds: 2,
  maxPrice: 2800,
  excludeIncomeRestricted: true,
  excludeMobileHomes: true,
  kidFriendlyPriority: true,
  schoolPriority: true
});

export function loadPreferences() {
  try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { ...defaultPreferences }; }
}
export function savePreferences(value) {
  localStorage.setItem(KEY, JSON.stringify({ ...defaultPreferences, ...value }));
}
