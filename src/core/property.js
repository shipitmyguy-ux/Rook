export const PROPERTY_STATUS = Object.freeze({
  NEW: "new",
  VIEWED: "viewed",
  SHORTLISTED: "shortlisted",
  CONTACTED: "contacted",
  SHOWING_REQUESTED: "showing-requested",
  SHOWING_SCHEDULED: "showing-scheduled",
  VISITED: "visited",
  REJECTED: "rejected",
  ARCHIVED: "archived"
});

export function normalizeProperty(input = {}) {
  return {
    id: String(input.id || crypto.randomUUID()),
    label: input.label || input.address || "Untitled property",
    address: input.address || "",
    type: input.type || "Property",
    listingType: input.listingType || "rent",
    price: Number.isFinite(input.price) ? input.price : null,
    beds: input.beds ?? null,
    baths: input.baths ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    status: input.status || PROPERTY_STATUS.NEW,
    saved: Boolean(input.saved),
    note: input.note || "",
    source: input.source || null,
    sourceUrl: input.sourceUrl || null,
    contactedAt: input.contactedAt || null,
    showingAt: input.showingAt || null,
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

export function searchProperties(properties, query) {
  const q = query.trim().toLowerCase();
  if (!q) return properties;
  return properties.filter(property =>
    [property.label, property.address, property.type, property.note]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q))
  );
}

export function filterProperties(properties, filter) {
  if (filter === "all") return properties;
  if (filter === "shortlist") return properties.filter(p => p.saved || p.status === PROPERTY_STATUS.SHORTLISTED);
  return properties.filter(p => p.listingType === filter);
}
