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
  if (!locations.length) {
    return "https://www.google.com/maps?q=" + encodeURIComponent("Fort Collins, CO") + "&z=12&output=embed";
  }

  if (locations.length === 1) {
    return "https://www.google.com/maps?q=" + encodeURIComponent(locations[0]) + "&z=15&output=embed";
  }

  // The simple Maps embed cannot fit multiple search pins. Directions mode
  // gives every supplied property a visible stop and auto-fits the viewport.
  const origin = locations[0];
  const destination = locations[locations.length - 1];
  const waypoints = locations.slice(1, -1);
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
    output: "embed"
  });
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));
  return "https://www.google.com/maps/dir/?" + params.toString();
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
