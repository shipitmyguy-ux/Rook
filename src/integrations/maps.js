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
  const query = locations.length ? locations.slice(0, 10).join(" | ") : "Fort Collins, CO";
  const zoom = locations.length > 1 ? 12 : 15;
  return "https://www.google.com/maps?q=" + encodeURIComponent(query) + "&z=" + zoom + "&output=embed";
}

export function renderPropertyMap(frame, properties = []) {
  if (!frame) return;
  frame.src = googleMapsEmbedUrl(properties);
  frame.title = properties.length > 1 ? `Map showing ${properties.length} properties` : properties.length ? "Property map" : "Rook property map";
}

export function openDirections(property) {
  const url = googleMapsDirectionsUrl(property);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
