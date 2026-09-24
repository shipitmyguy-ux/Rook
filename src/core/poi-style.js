export const POI_ICON_OPTIONS = Object.freeze([
  { value: "circle", label: "Circle", glyph: "●" },
  { value: "diamond", label: "Diamond", glyph: "◆" },
  { value: "square", label: "Square", glyph: "■" },
  { value: "triangle", label: "Triangle", glyph: "▲" },
  { value: "star", label: "Star", glyph: "★" },
  { value: "hexagon", label: "Hexagon", glyph: "⬢" }
]);

export const POI_COLOR_OPTIONS = Object.freeze([
  { value: "slate", label: "Slate", hex: "#aeb8c3" },
  { value: "teal", label: "Teal", hex: "#58eadc" },
  { value: "blue", label: "Blue", hex: "#4ba8ff" },
  { value: "gold", label: "Gold", hex: "#ffc429" },
  { value: "purple", label: "Purple", hex: "#b276e8" },
  { value: "rose", label: "Rose", hex: "#d98aa8" }
]);

const ICONS = new Map(POI_ICON_OPTIONS.map(option => [option.value, option]));
const COLORS = new Map(POI_COLOR_OPTIONS.map(option => [option.value, option]));
const DEFAULT_ICONS = POI_ICON_OPTIONS.map(option => option.value);

export function normalizePoiStyle(value = {}, index = 0) {
  const fallbackIcon = DEFAULT_ICONS[Math.max(0, Number(index) || 0) % DEFAULT_ICONS.length];
  const icon = ICONS.has(value?.icon) ? value.icon : fallbackIcon;
  const color = COLORS.has(value?.color) ? value.color : "slate";
  return { icon, color };
}

export function normalizePointStyles(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id]) => String(id).trim())
      .map(([id, style], index) => [String(id), normalizePoiStyle(style, index)])
  );
}

export function resolvePoiStyle(point = {}, index = 0, pointStyles = {}) {
  if (point.primary) return { icon: "star", color: "gold" };
  return normalizePoiStyle({
    ...point,
    ...(pointStyles?.[point.id] || {})
  }, index);
}

export function poiGlyph(icon) {
  return ICONS.get(icon)?.glyph || ICONS.get("circle").glyph;
}

export function poiColorHex(color) {
  return COLORS.get(color)?.hex || COLORS.get("slate").hex;
}
