import { classifyHousingEmail, matchEmailToProperty, normalizeEmailEvent } from "./email.js";
import { applyTour, normalizeTour } from "../core/tours.js";
import { applyEvidence } from "../core/property.js";

export function getRookSyncBridge() {
  return globalThis.rookSyncBridge || null;
}

export async function scanHousingEmail(properties = [], options = {}) {
  const bridge = getRookSyncBridge();
  if (!bridge?.scanEmail) return { connected:false, scanned:0, updates:[], review:[], lastScanAt:null };
  const payload = await bridge.scanEmail({
    since: options.since || null,
    propertyHints: properties.map(p => ({ id:p.id, label:p.label, address:p.address }))
  });
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const updates = [];
  const review = [];
  for (const message of messages) {
    const property = matchEmailToProperty(message, properties);
    if (!property) continue;
    const event = normalizeEmailEvent({ ...message, propertyId:property.id });
    const kind = event.kind || classifyHousingEmail(message);
    const tour = message.tour || (message.startsAt ? { startsAt:message.startsAt, endsAt:message.endsAt, status:message.status, confidence:message.confidence } : null);
    const confidence = message.confidence || tour?.confidence || "possible";
    if (kind === "showing-scheduled" && tour?.startsAt && confidence === "confirmed") {
      updates.push({
        propertyId:property.id,
        kind,
        property:applyTour(applyEvidence(property, { ...event, kind, startsAt:tour.startsAt }), {
          ...normalizeTour({ ...tour, propertyId:property.id, source:"email", sourceMessageId:message.id, sourceThreadId:message.threadId }, options.preferences),
          sourceMessageId:message.id,
          sourceThreadId:message.threadId
        }, options.preferences),
        email:event
      });
    } else if (["showing-scheduled","showing-rescheduled","showing-cancelled","showing-proposed"].includes(kind)) {
      review.push({ propertyId:property.id, kind, email:event, tour, confidence });
    } else {
      updates.push({ propertyId:property.id, kind, property:applyEvidence(property, { ...event, kind }), email:event });
    }
  }
  return {
    connected:true,
    scanned:messages.length,
    updates,
    review,
    cursor:payload?.cursor || options.since || null,
    lastScanAt:new Date().toISOString()
  };
}

export async function reconcileTourCalendar(property, tour, options = {}) {
  const bridge = getRookSyncBridge();
  if (!bridge?.upsertCalendarEvent) return { connected:false, tour };
  const result = await bridge.upsertCalendarEvent({
    property:{ id:property.id, label:property.label, address:property.address, sourceUrl:property.sourceUrl },
    tour,
    reminderMinutes:tour.reminderMinutes,
    durationMinutes:tour.durationMinutes,
    existingEventId:tour.calendarEventId || null
  });
  return {
    connected:true,
    tour:{ ...tour, calendarEventId:result?.eventId || tour.calendarEventId || null, calendarUrl:result?.url || tour.calendarUrl || null }
  };
}
