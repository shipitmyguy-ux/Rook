export function googleMapsDirectionsUrl(property) {
  const destination = property.address || [property.lat, property.lng].filter(v => v != null).join(",");
  if (!destination) return null;
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
}

function mapLocation(property) {
  if (property?.address) return property.address;
  if (property?.lat != null && property?.lng != null) return `${property.lat},${property.lng}`;
  return null;
}

function usableLocations(properties = []) {
  return [...new Set(properties.map(mapLocation).filter(Boolean))];
}

export function googleMapsEmbedUrl(properties = []) {
  const locations = usableLocations(properties);
  // Google's keyless iframe endpoint supports a single search query reliably.
  // Center on the active result set's first property; individual cards provide
  // directions links. A true multi-marker overview requires the Maps JS API.
  const target = locations[0] || "Fort Collins, CO";
  const zoom = locations.length > 1 ? 12 : 15;
  return "https://maps.google.com/maps?q=" + encodeURIComponent(target) + "&z=" + zoom + "&output=embed";
}

export function renderPropertyMap(frame, properties = []) {
  if (!frame) return;
  frame.removeAttribute("srcdoc");
  frame.src = googleMapsEmbedUrl(properties);
  frame.title = properties.length > 1 ? `Map centered on ${properties.length} active properties` : properties.length ? "Property map" : "Rook property map";
}

export function openDirections(property) {
  const url = googleMapsDirectionsUrl(property);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
