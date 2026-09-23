export function normalizeShowingEvent(input = {}) {
  return {
    id: input.id || null,
    propertyId: input.propertyId || null,
    title: input.title || "Property showing",
    startsAt: input.startsAt || null,
    endsAt: input.endsAt || null,
    location: input.location || "",
    source: input.source || "calendar",
    status: input.status || "confirmed"
  };
}

export function matchCalendarEventToProperty(event = {}, properties = []) {
  const text = [event.title, event.summary, event.location, event.description].filter(Boolean).join(" ").toLowerCase();
  return properties.find(property => {
    const street = String(property.address || "").split(",")[0].trim().toLowerCase();
    const label = String(property.label || "").toLowerCase();
    return (street.length > 5 && text.includes(street)) || (label.length > 5 && text.includes(label));
  }) || null;
}

export function isShowingEvent(event = {}) {
  return /\b(showing|property tour|apartment tour|home tour|walkthrough)\b/i.test([event.title,event.summary,event.description].filter(Boolean).join(" "));
}

export function googleCalendarShowingUrl(property, startsAt, durationMinutes = 30) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const stamp = value => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Property showing · ${property.label || property.address || "Rental"}`,
    dates: `${stamp(start)}/${stamp(end)}`,
    location: property.address || "",
    details: property.sourceUrl ? `Listing: ${property.sourceUrl}` : "Rook property showing"
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
