export const config = Object.freeze({
  maps: {
    provider: "maplibre",
    tiles: "openfreemap",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    terrainEnabled: false
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
