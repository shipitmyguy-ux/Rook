import { config } from "./config.js";

const MAX_MESSAGE = 1800;
const MAX_CONTEXT = 3500;
const recent = new Map();

function compact(value, max = MAX_CONTEXT) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return String(text || "").slice(0, max);
  } catch {
    return "";
  }
}

function signature(source, kind, message) {
  return [source, kind, message].join("|").slice(0, 1500);
}

export async function reportRuntimeError(error, context = {}) {
  const message = String(error?.message || error || "Unknown runtime error").slice(0, MAX_MESSAGE);
  const source = String(context.source || "browser").slice(0, 80);
  const kind = String(context.kind || error?.name || "runtime").slice(0, 80);
  const key = signature(source, kind, message);
  const now = Date.now();
  if (now - Number(recent.get(key) || 0) < 30000) return false;
  recent.set(key, now);

  const endpoint = config.listings?.endpoint;
  if (!endpoint) return false;
  const payload = {
    source,
    kind,
    message,
    context: {
      path: globalThis.location?.pathname || "",
      build: globalThis.document?.documentElement?.dataset?.build || null,
      detail: compact(context.detail || ""),
      recovery: compact(context.recovery || "")
    }
  };

  try {
    const url = new URL(endpoint, globalThis.location?.href || "https://shipitmyguy-ux.github.io/Rook/");
    url.searchParams.set("reportError", "1");
    await fetch(url, {
      method:"POST",
      keepalive:true,
      headers:{ "content-type":"application/json" },
      body:JSON.stringify(payload)
    });
    return true;
  } catch {
    return false;
  }
}

export function installRuntimeErrorHooks() {
  window.addEventListener("error", event => {
    void reportRuntimeError(event.error || event.message, {
      source:"browser-global",
      kind:"error",
      detail:event.filename ? event.filename + ":" + event.lineno + ":" + event.colno : ""
    });
  });
  window.addEventListener("unhandledrejection", event => {
    void reportRuntimeError(event.reason, {
      source:"browser-global",
      kind:"unhandledrejection"
    });
  });
}
