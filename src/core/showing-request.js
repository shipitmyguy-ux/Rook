export function showingRequestMessage(property = {}, availability = "", timeZone = "America/Denver") {
  const place = property.label || property.address || "this property";
  const times = String(availability).trim();
  return `Hi, I’d like to schedule a showing for ${place}.\n\n${times ? "I’m available " + times + " (" + timeZone + ")." : "Please let me know your available showing times."}\n\nPlease let me know what works. Thank you!`;
}
export function showingRequestPatch(property = {}, message = "", now = new Date().toISOString()) {
  if (property.status === "showing-scheduled" || property.showingAt) return null;
  return { status:"showing-requested", contactOutcome:"showing-requested", contactedAt:now,
    metadata:{...property.metadata, showingRequest:{sentAt:now,message:String(message),state:"pending"}} };
}
export function isShowingPending(property = {}) {
  return property.status === "showing-requested" && !property.showingAt;
}
