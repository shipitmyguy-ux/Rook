export function googleMapsDirectionsUrl(property) {
  const destination = property.address || [property.lat, property.lng].filter(v => v != null).join(",");
  if (!destination) return null;
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
}

export function googleMapsEmbedUrl(properties = []) {
  const usable = properties.filter(property => property.address || (property.lat != null && property.lng != null));
  if (!usable.length) return "https://www.google.com/maps?q=Fort%20Collins%2C%20CO&output=embed";
  const query = usable.length === 1
    ? usable[0].address || `${usable[0].lat},${usable[0].lng}`
    : usable.map(property => property.address || `${property.lat},${property.lng}`).join(" | ");
  return "https://www.google.com/maps?q=" + encodeURIComponent(query) + "&output=embed";
}

export function renderPropertyMap(frame, properties = []) {
  if (!frame) return;
  frame.src = googleMapsEmbedUrl(properties);
  frame.title = properties.length ? `Map showing ${properties.length} saved properties` : "Rook property map";
}

export function openDirections(property) {
  const url = googleMapsDirectionsUrl(property);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
