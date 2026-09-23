import { PROPERTY_STATUS } from "./property.js";

export const CONTACT_OUTCOME = Object.freeze({
  NONE: "none",
  INFO_REQUESTED: "info-requested",
  SHOWING_REQUESTED: "showing-requested",
  SHOWING_SCHEDULED: "showing-scheduled",
  REPLIED: "replied",
  CLOSED: "closed"
});

export function nextFollowUp(property, now = new Date()) {
  if (!property.contactedAt || [PROPERTY_STATUS.ARCHIVED, PROPERTY_STATUS.REJECTED].includes(property.status)) return null;
  if (property.showingAt) return { kind: "showing", at: property.showingAt };
  const contacted = new Date(property.contactedAt);
  const due = new Date(contacted.getTime() + 24 * 60 * 60 * 1000);
  return { kind: due <= now ? "follow-up-due" : "waiting", at: due.toISOString() };
}

export function markShowingRequested(property) {
  return {
    ...property,
    status: PROPERTY_STATUS.SHOWING_REQUESTED,
    contactOutcome: CONTACT_OUTCOME.SHOWING_REQUESTED,
    contactedAt: property.contactedAt || new Date().toISOString()
  };
}
