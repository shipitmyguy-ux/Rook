export function googleMapsDirectionsUrl(property) {
  const destination = property.address || [property.lat, property.lng].filter(v => v != null).join(",");
  if (!destination) return null;
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
}

function mapTarget(properties = []) {
  const usable = properties.filter(property => property.address || (property.lat != null && property.lng != null));
  const preferred = usable.find(property => property.saved && property.address) || usable.find(property => property.address) || usable[0];
  return preferred?.address || (preferred ? `${preferred.lat},${preferred.lng}` : "Fort Collins, CO");
}

export function googleMapsEmbedUrl(properties = []) {
  // Google Maps' simple embed search ignores z= when the query contains a
  // multi-address string. Center on one relevant property instead so the
  // initial viewport is genuinely neighborhood-level.
  const target = mapTarget(properties);
  return "https://www.google.com/maps?q=" + encodeURIComponent(target) + "&z=15&output=embed";
}

export function renderPropertyMap(frame, properties = []) {
  if (!frame) return;
  frame.src = googleMapsEmbedUrl(properties);
  frame.title = properties.length ? `Map centered near saved properties` : "Rook property map";
}

export function openDirections(property) {
  const url = googleMapsDirectionsUrl(property);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
