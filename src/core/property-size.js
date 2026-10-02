// Interior floor area only; lot size is deliberately excluded.
function area(value) {
  if (value == null || value === "") return null;
  const raw = typeof value === "object" ? value.value : value;
  const unit = typeof value === "object" ? String(value.unitCode || value.unitText || "") : "";
  const number = Number(String(raw).replace(/,/g, "").replace(/\s*(?:sq\.?\s*ft|sqft|square feet)\s*$/i, ""));
  if (!Number.isFinite(number) || number <= 0) return null;
  if (unit && !/^(FTK|sqft|sq\.?\s*ft|square feet|MTK|m2|m²|square meters?)$/i.test(unit)) return null;
  return Math.round(number * (/^(MTK|m2|m²|square meters?)$/i.test(unit) ? 10.7639104167 : 1));
}
export function squareFootageFromText(text = "") {
  const match = String(text).match(/(?<![\d,.])([\d]{1,3}(?:,[\d]{3})+|[\d]+)\s*(?:sq\.?\s*ft\.?|sqft|square feet)\b/i);
  return match ? area(match[1]) : null;
}
export function propertySquareFeet(property = {}) {
  for (const source of [property, property.metadata || {}]) {
    for (const key of ["sqft", "squareFeet", "squareFootage", "livingArea", "floorSize"]) {
      const result = area(source[key]);
      if (result !== null) return result;
    }
  }
  return squareFootageFromText(property.metadata?.description);
}
export function squareFootageLabel(property = {}) {
  const format = value => value.toLocaleString("en-US");
  const sqft = propertySquareFeet(property);
  if (sqft !== null) return format(sqft) + " sq ft";
  const sizes = (property.metadata?.units || []).map(propertySquareFeet).filter(value => value !== null);
  if (!sizes.length) return "";
  const min = Math.min(...sizes), max = Math.max(...sizes);
  return (min === max ? format(min) : format(min) + "–" + format(max)) + " sq ft";
}
