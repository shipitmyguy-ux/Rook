// Connector-neutral email event schema. Live Gmail synchronization can feed
// these events without coupling the property UI to a specific mail provider.
export function normalizeEmailEvent(input = {}) {
  return {
    id: input.id || null,
    propertyId: input.propertyId || null,
    threadId: input.threadId || null,
    direction: input.direction || "inbound",
    kind: input.kind || "unknown",
    occurredAt: input.occurredAt || null,
    subject: input.subject || ""
  };
}

export function latestPropertyEmail(events, propertyId) {
  return events
    .filter(event => event.propertyId === propertyId)
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))[0] || null;
}
