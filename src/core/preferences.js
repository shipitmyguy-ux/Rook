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
  showingAvailability: "",
  showingTimeZone: "America/Denver",
  defaultTourDurationMinutes: 60,
  defaultTourReminderMinutes: 120,
  emailScanCursor: null,
  emailLastScanAt: null,
  googleOAuthClientId: "",
  removedPointIds: []
});

export function normalizePreferences(value = {}, overrides = {}) {
  const defaults = { ...defaultPreferences, ...(overrides || {}) };
  const types = Array.isArray(value.propertyTypes) ? value.propertyTypes.filter(Boolean) : defaults.propertyTypes;
  const removedPointIds = Array.isArray(value.removedPointIds) ? [...new Set(value.removedPointIds.map(String))] : [];
  const pointsOfInterest = Array.isArray(value.pointsOfInterest) ? [...value.pointsOfInterest] : [];
  if (value.address1 && !removedPointIds.includes("address-1") && !pointsOfInterest.some(point => String(point?.id) === "address-1")) {
    pointsOfInterest.unshift({ id:"address-1", ...value.address1, primary:false, kind:"poi" });
  }
  return {
    ...defaults,
    ...value,
    address1:null,
    pointsOfInterest,
    location: String(value.location || defaults.location).trim(),
    radiusMiles: Math.max(1, Number(value.radiusMiles) || defaults.radiusMiles),
    minBeds: Math.max(0, Number(value.minBeds) || 0),
    maxPrice: Number(value.maxPrice) > 0 ? Number(value.maxPrice) : null,
    propertyTypes: Array.isArray(value.propertyTypes) ? [...new Set(types)] : [...defaults.propertyTypes],
    excludeIncomeRestricted: value.excludeIncomeRestricted !== false,
    excludeMobileHomes: value.excludeMobileHomes !== false,
    kidFriendlyPriority: value.kidFriendlyPriority !== false,
    schoolPriority: value.schoolPriority !== false,
    pointStyles: normalizePointStyles(value.pointStyles),
    showingAvailability: String(value.showingAvailability || "").trim(),
    showingTimeZone: String(value.showingTimeZone || "America/Denver").trim(),
    defaultTourDurationMinutes: Math.max(15, Number(value.defaultTourDurationMinutes) || 60),
    defaultTourReminderMinutes: Math.max(0, Number(value.defaultTourReminderMinutes) || 120),
    emailScanCursor: value.emailScanCursor || null,
    emailLastScanAt: value.emailLastScanAt || null,
    googleOAuthClientId: String(value.googleOAuthClientId || "").trim(),
    removedPointIds
  };
}
export function loadPreferences(overrides = {}) {
  const defaults = { ...defaultPreferences, ...(overrides || {}) };
  try { return normalizePreferences(JSON.parse(localStorage.getItem(KEY) || "{}"), defaults); }
  catch { return { ...defaults, propertyTypes:[...(defaults.propertyTypes || defaultPreferences.propertyTypes)] }; }
}

export function savePreferences(value, overrides = {}) {
  localStorage.setItem(KEY, JSON.stringify(normalizePreferences(value, overrides)));
}
