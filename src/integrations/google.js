function propertyForText(properties, text = "") {
  const haystack = text.toLowerCase();
  return properties.find(property => [property.address, property.label]
    .filter(Boolean).some(value => haystack.includes(value.toLowerCase())));
}

async function googleJson(path, token) {
  const response = await fetch("https://www.googleapis.com" + path, { headers: { Authorization: "Bearer " + token } });
  if (!response.ok) throw new Error("Google sync failed (" + response.status + "). Reconnect Google and try again.");
  return response.json();
}

export async function syncGoogleActivity({ token, properties, storeExternalEvents }) {
  if (!token) throw new Error("Connect Google again to grant Gmail and Calendar access.");
  const [gmail, calendar] = await Promise.all([
    googleJson("/gmail/v1/users/me/messages?maxResults=100&q=" + encodeURIComponent("newer_than:365d"), token),
    googleJson("/calendar/v3/calendars/primary/events?singleEvents=true&maxResults=250&orderBy=startTime&timeMin=" + encodeURIComponent(new Date(Date.now() - 365 * 864e5).toISOString()), token)
  ]);
  const messages = await Promise.all((gmail.messages || []).map(async message => {
    const detail = await googleJson("/gmail/v1/users/me/messages/" + message.id + "?format=metadata&metadataHeaders=Subject", token);
    const subject = detail.payload?.headers?.find(header => header.name.toLowerCase() === "subject")?.value || "";
    const property = propertyForText(properties, subject + " " + detail.snippet);
    return property ? { source: "gmail", external_id: message.id, property_id: property.id, kind: /showing|tour|visit/i.test(subject + detail.snippet) ? "showing" : "contact", occurred_at: new Date(Number(detail.internalDate)).toISOString(), data: { subject } } : null;
  }));
  const events = (calendar.items || []).map(event => {
    const property = propertyForText(properties, [event.summary, event.description, event.location].filter(Boolean).join(" "));
    return property ? { source: "calendar", external_id: event.id, property_id: property.id, kind: "showing", occurred_at: event.start?.dateTime || event.start?.date || null, data: { summary: event.summary || "", location: event.location || "" } } : null;
  }).filter(Boolean);
  const matched = [...messages.filter(Boolean), ...events];
  await storeExternalEvents(matched);
  return matched;
}
