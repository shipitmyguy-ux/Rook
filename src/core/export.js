export function exportRookData(properties, preferences) {
  const blob = new Blob([JSON.stringify({ version:1, exportedAt:new Date().toISOString(), preferences, properties }, null, 2)], {type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download="rook-backup.json"; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

export function parseRookBackup(text) {
  const data = JSON.parse(text);
  if (!data || data.version !== 1) throw new Error("Unsupported Rook backup version");
  if (!Array.isArray(data.properties)) throw new Error("Backup is missing property data");
  const preferences = data.preferences && typeof data.preferences === "object" ? data.preferences : {};
  return { properties: data.properties, preferences };
}
