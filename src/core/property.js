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

export function classifyPropertyKind(property = {}) {
  const haystack = [property.type, property.label, property.metadata?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\btown\s*home\b|\btownhouse\b/.test(haystack)) return "townhome";
  if (/\bapartments?\b|\bapt\b|\bcondo(?:minium)?s?\b|\bflats?\b|\bapartment complex\b/.test(haystack)) return "apartment";
  if (/\bsingle[-\s]?family\b|\bdetached\b|\bhouse\b|\bsingle family home\b/.test(haystack)) return "house";
  return "rental";
}

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
    contactOutcome: input.contactOutcome || null,
    showingAt: input.showingAt || null,
    nearSchool: Boolean(input.nearSchool),
    kidFriendly: Boolean(input.kidFriendly),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

export function searchProperties(properties, query) {
  const q = query.trim().toLowerCase();
  if (!q) return properties;
  return properties.filter(property =>
    [property.label, property.address, property.type, property.note, property.source]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q))
  );
}

export function filterProperties(properties, filter) {
  const active = p => ![PROPERTY_STATUS.ARCHIVED, PROPERTY_STATUS.REJECTED].includes(p.status);
  if (filter === "all") return properties.filter(active);
  if (filter === "shortlist") return properties.filter(p => (p.saved || p.status === PROPERTY_STATUS.SHORTLISTED) && active(p));
  return properties.filter(p => p.listingType === filter && active(p));
}

export function applyEvidence(property, evidence = {}) {
  const patch = { metadata: { ...(property.metadata || {}) } };
  if (evidence.kind === "showing-scheduled") {
    patch.status = PROPERTY_STATUS.SHOWING_SCHEDULED;
    patch.contactOutcome = "showing-scheduled";
    if (evidence.startsAt || evidence.occurredAt) patch.showingAt = evidence.startsAt || evidence.occurredAt;
  } else if (evidence.kind === "showing-requested" && ![PROPERTY_STATUS.SHOWING_SCHEDULED, PROPERTY_STATUS.VISITED].includes(property.status)) {
    patch.status = PROPERTY_STATUS.SHOWING_REQUESTED;
    patch.contactOutcome = "showing-requested";
  } else if (evidence.kind === "unavailable") {
    patch.status = PROPERTY_STATUS.REJECTED;
    patch.contactOutcome = "unavailable";
  } else if (["response", "application"].includes(evidence.kind) && property.status === PROPERTY_STATUS.NEW) {
    patch.status = PROPERTY_STATUS.CONTACTED;
    patch.contactOutcome = evidence.kind;
  }
  if (evidence.occurredAt) patch.contactedAt = property.contactedAt || evidence.occurredAt;
  const prior = Array.isArray(patch.metadata.evidence) ? patch.metadata.evidence : [];
  patch.metadata.evidence = [...prior.filter(item => !evidence.id || item.id !== evidence.id), evidence].slice(-20);
  return normalizeProperty({ ...property, ...patch, id: property.id, updatedAt: new Date().toISOString() });
}
