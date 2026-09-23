export function exportRookData(properties, preferences) {
  const blob = new Blob([JSON.stringify({ version:1, exportedAt:new Date().toISOString(), preferences, properties }, null, 2)], {type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download="rook-backup.json"; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
