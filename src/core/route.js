export function googleMapsMultiStopUrl(properties) {
  const stops = properties.map(p => p.address).filter(Boolean);
  if (!stops.length) return null;
  const destination = stops.at(-1);
  const waypoints = stops.slice(0,-1);
  const params = new URLSearchParams({ api:"1", destination });
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));
  return "https://www.google.com/maps/dir/?" + params.toString();
}
