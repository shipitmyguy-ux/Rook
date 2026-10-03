export function createSpeedMetrics({ now = () => performance.now(), persist = () => {}, startAt } = {}) {
  const started = startAt ?? now(), samples = {};
  return {
    mark(name, detail = {}) {
      if (samples[name]) return samples[name];
      const sample = {ms:Math.round(now() - started), ...detail};
      samples[name] = sample; persist({...samples}); return sample;
    },
    snapshot() { return {...samples}; }
  };
}
