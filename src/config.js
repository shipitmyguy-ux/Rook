export const config = Object.freeze({
  maps: { provider: "google", terrainEnabled: true },
  search: { minBeds: 2, excludeIncomeRestricted: true, excludeMobileHomes: true },
  followUp: { defaultHours: 24 },
  // Public browser configuration. Leave blank to use local-only storage.
  // Never place a Supabase service-role key in this file.
  supabaseUrl: "",
  supabasePublishableKey: ""
});
