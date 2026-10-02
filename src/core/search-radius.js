export function distanceMiles(point, center) {
  if (!point || !center || ![point.lat,point.lng,center.lat,center.lng].every(value => value !== null && value !== "" && Number.isFinite(Number(value)))) return null;
  const rad = Math.PI / 180;
  const lat1 = Number(center.lat) * rad, lat2 = Number(point.lat) * rad;
  const dLat = lat2 - lat1, dLng = (Number(point.lng)-Number(center.lng))*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1,h)));
}

export function pointWithinSearchRadius(point, center, radiusMiles) {
  const distance = distanceMiles(point, center);
  const radius = Number(radiusMiles);
  if (distance === null || !Number.isFinite(radius) || radius <= 0) return null;
  return distance <= radius + 1e-8;
}
