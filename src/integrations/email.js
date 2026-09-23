// Connector-neutral email evidence. Gmail synchronization translates messages
// into these events; property UI remains provider-independent.
const RULES = [
  ["showing-scheduled", /(?:showing|tour|appointment).{0,40}(?:confirmed|scheduled|booked)|(?:confirmed|scheduled).{0,40}(?:showing|tour)/i],
  ["showing-requested", /(?:request|requested|interested).{0,35}(?:showing|tour)|(?:showing|tour).{0,35}(?:request|requested)/i],
  ["unavailable", /(?:no longer available|already (?:rented|leased)|unit has been (?:rented|leased)|not available)/i],
  ["application", /(?:application|apply).{0,35}(?:received|submitted|complete)/i],
  ["response", /(?:thanks for (?:your )?(?:interest|inquiry)|regarding (?:the )?(?:property|apartment|home)|leasing)/i]
];

export function classifyHousingEmail(input = {}) {
  const text = [input.subject, input.snippet, input.body].filter(Boolean).join("\n");
  const match = RULES.find(([, pattern]) => pattern.test(text));
  return match?.[0] || "unknown";
}

export function matchEmailToProperty(input = {}, properties = []) {
  const text = [input.subject, input.snippet, input.body].filter(Boolean).join(" ").toLowerCase();
  return properties.find(property => {
    const address = String(property.address || "").toLowerCase();
    const label = String(property.label || "").toLowerCase();
    const street = address.split(",")[0].trim();
    return (street.length > 5 && text.includes(street)) || (label.length > 5 && text.includes(label));
  }) || null;
}

export function normalizeEmailEvent(input = {}) {
  return {
    id: input.id || null,
    propertyId: input.propertyId || null,
    threadId: input.threadId || null,
    direction: input.direction || "inbound",
    kind: input.kind || classifyHousingEmail(input),
    occurredAt: input.occurredAt || null,
    subject: input.subject || ""
  };
}

export function latestPropertyEmail(events, propertyId) {
  return events.filter(event => event.propertyId === propertyId)
    .sort((a,b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))[0] || null;
}
