export const config = Object.freeze({
  maps: {
    provider: "google",
    terrainEnabled: true
  },
  search: {
    minBeds: 2,
    excludeIncomeRestricted: true,
    excludeMobileHomes: true,
    location: "Fort Collins, CO"
  },
  listings: {
    endpoint: "https://umvmilulnqnmeqvfoxxc.supabase.co/functions/v1/rook-listings"
  },
  followUp: {
    defaultHours: 24
  }
});
