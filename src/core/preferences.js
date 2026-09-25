import { normalizePointStyles } from "./poi-style.js";

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
  schoolPriority: true,
  visualTheme: "default",
  pointStyles: {},
  defaultTourDurationMinutes: 60,
  defaultTourReminderMinutes: 120,
  emailScanCursor: null,
  emailLastScanAt: null,
  removedPointIds: []
});

export function normalizePreferences(value = {}) {
  const types = Array.isArray(value.propertyTypes) ? value.propertyTypes.filter(Boolean) : defaultPreferences.propertyTypes;
  const removedPointIds = Array.isArray(value.removedPointIds) ? [...new Set(value.removedPointIds.map(String))] : [];
  const pointsOfInterest = Array.isArray(value.pointsOfInterest) ? [...value.pointsOfInterest] : [];
  if (value.address1 && !removedPointIds.includes("address-1") && !pointsOfInterest.some(point => String(point?.id) === "address-1")) {
    pointsOfInterest.unshift({ id:"address-1", ...value.address1, primary:false, kind:"poi" });
  }
  return {
    ...defaultPreferences,
    ...value,
    address1:null,
    pointsOfInterest,
    location: String(value.location || defaultPreferences.location).trim(),
    radiusMiles: Math.max(1, Number(value.radiusMiles) || defaultPreferences.radiusMiles),
    minBeds: Math.max(0, Number(value.minBeds) || 0),
    maxPrice: Number(value.maxPrice) > 0 ? Number(value.maxPrice) : null,
    propertyTypes: Array.isArray(value.propertyTypes) ? [...new Set(types)] : [...defaultPreferences.propertyTypes],
    excludeIncomeRestricted: value.excludeIncomeRestricted !== false,
    excludeMobileHomes: value.excludeMobileHomes !== false,
    kidFriendlyPriority: value.kidFriendlyPriority !== false,
    schoolPriority: value.schoolPriority !== false,
    pointStyles: normalizePointStyles(value.pointStyles),
    defaultTourDurationMinutes: Math.max(15, Number(value.defaultTourDurationMinutes) || 60),
    defaultTourReminderMinutes: Math.max(0, Number(value.defaultTourReminderMinutes) || 120),
    emailScanCursor: value.emailScanCursor || null,
    emailLastScanAt: value.emailLastScanAt || null,
    removedPointIds
  };
}
export function loadPreferences() {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return { ...defaultPreferences, propertyTypes:[...defaultPreferences.propertyTypes] }; }
}
export function savePreferences(value) {
  localStorage.setItem(KEY, JSON.stringify(normalizePreferences(value)));
}
