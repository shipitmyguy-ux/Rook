import { classifyHousingEmail, matchEmailToProperty, normalizeEmailEvent } from "./email.js";
import { applyTour, normalizeTour } from "../core/tours.js";
import { applyEvidence, normalizeProperty, PROPERTY_STATUS } from "../core/property.js";
import { config } from "../config.js";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
let googleIdentityPromise = null;
let gmailAccessToken = null;
let gmailAccessTokenExpiresAt = 0;

function loadGoogleIdentityServices() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve(globalThis.google);
  if (googleIdentityPromise) return googleIdentityPromise;
  googleIdentityPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-rook-google-identity]');
    if (existing) {
      existing.addEventListener("load", () => resolve(globalThis.google), { once:true });
      existing.addEventListener("error", () => reject(new Error("Google Identity Services failed to load")), { once:true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.rookGoogleIdentity = "true";
    script.onload = () => resolve(globalThis.google);
    script.onerror = () => reject(new Error("Google Identity Services failed to load"));
    document.head.append(script);
  });
  return googleIdentityPromise;
}

async function getGmailAccessToken(clientId) {
  if (gmailAccessToken && Date.now() < gmailAccessTokenExpiresAt - 60000) return gmailAccessToken;
  const googleApi = await loadGoogleIdentityServices();
  return new Promise((resolve, reject) => {
    let tokenClient;
    try {
      tokenClient = googleApi.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GMAIL_SCOPE,
        callback: response => {
          if (response?.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          gmailAccessToken = response.access_token || null;
          gmailAccessTokenExpiresAt = Date.now() + Math.max(60, Number(response.expires_in || 3600)) * 1000;
          if (!gmailAccessToken) reject(new Error("Google did not return a Gmail access token"));
          else resolve(gmailAccessToken);
        }
      });
    } catch (error) {
      reject(error);
      return;
    }
    tokenClient.requestAccessToken({ prompt:"consent" });
  });
}

function decodeBase64Url(value = "") {
  if (!value) return "";
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function stripEmailHtml(value = "") {
  const div = document.createElement("div");
  div.innerHTML = value;
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

function gmailPartText(part = {}) {
  const mime = String(part.mimeType || "").toLowerCase();
  const direct = decodeBase64Url(part.body?.data || "");
  if (mime === "text/plain" && direct) return direct;
  if (mime === "text/html" && direct) return stripEmailHtml(direct);
  const children = Array.isArray(part.parts) ? part.parts : [];
  const plain = children.map(gmailPartText).filter(Boolean);
  return plain.join("\n").trim();
}

function gmailHeader(headers = [], name = "") {
  const match = headers.find(header => String(header.name || "").toLowerCase() === name.toLowerCase());
  return match?.value || "";
}

async function gmailFetch(path, token) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
    headers:{ Authorization:"Bearer " + token, Accept:"application/json" }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Gmail API returned " + response.status + (detail ? ": " + detail.slice(0,180) : ""));
  }
  return response.json();
}

function gmailSearchQuery(since) {
  const parts = [
    "-in:spam",
    "-in:trash",
    "{showing tour appointment rental apartment property leasing application}"
  ];
  if (since) {
    const date = new Date(since);
    if (!Number.isNaN(date.getTime())) {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      parts.unshift("after:" + yyyy + "/" + mm + "/" + dd);
    }
  } else {
    parts.unshift("newer_than:30d");
  }
  return parts.join(" ");
}

async function scanGmailInBrowser({ since = null, preferences = {} } = {}) {
  const clientId = String(preferences.googleOAuthClientId || "").trim();
  if (!clientId) return { connected:false, setupRequired:true, scanned:0, updates:[], review:[], lastScanAt:null };
  const token = await getGmailAccessToken(clientId);
  const query = encodeURIComponent(gmailSearchQuery(since));
  const list = await gmailFetch("messages?q=" + query + "&maxResults=50", token);
  const ids = Array.isArray(list.messages) ? list.messages.map(item => item.id).filter(Boolean) : [];
  const messages = [];
  for (let index = 0; index < ids.length; index += 8) {
    const batch = await Promise.all(ids.slice(index, index + 8).map(async id => {
      const message = await gmailFetch("messages/" + encodeURIComponent(id) + "?format=full", token);
      const headers = message.payload?.headers || [];
      const subject = gmailHeader(headers, "Subject");
      const dateValue = gmailHeader(headers, "Date");
      const occurredAt = dateValue ? new Date(dateValue).toISOString() : null;
      return {
        id:message.id,
        threadId:message.threadId || null,
        subject,
        snippet:message.snippet || "",
        body:gmailPartText(message.payload || {}),
        occurredAt,
        from:gmailHeader(headers, "From")
      };
    }));
    messages.push(...batch);
  }
  return {
    connected:true,
    messages,
    cursor:new Date().toISOString()
  };
}

export function applySharedRookStateRow(property = {}, row = {}, preferences = {}) {
  const rawTour = row?.tour && typeof row.tour === "object" ? row.tour : {};
  const startsAt = rawTour.startsAt || row.showing_at || null;
  let next = normalizeProperty({
    ...property,
    id:property.id,
    ...(row.address ? {address:row.address} : {}),
    ...(row.label ? {label:row.label} : {}),
    ...(row.contact_outcome ? {contactOutcome:row.contact_outcome} : {}),
    saved:Boolean(property.saved || row.saved || row.status === PROPERTY_STATUS.SHOWING_SCHEDULED),
    metadata:{
      ...(property.metadata || {}),
      sharedSyncUpdatedAt:row.updated_at || null,
      sharedSyncLastEmailAt:row.last_email_at || null,
      sharedSyncSourceMessageIds:Array.isArray(row.source_message_ids) ? row.source_message_ids : [],
      evidence:Array.isArray(row.evidence) ? row.evidence : (property.metadata?.evidence || []),
      ...(rawTour.communityId ? { communityId:String(rawTour.communityId) } : {})
    }
  });
  if (startsAt) {
    next = applyTour(next, {
      ...rawTour,
      startsAt,
      source:rawTour.source || "shared-sync"
    }, preferences);
  } else if (row.status) {
    next = normalizeProperty({ ...next, id:next.id, status:row.status, showingAt:null });
  }
  return next;
}

export async function fetchSharedRookState(fetchImpl = fetch) {
  const endpoint = config.listings?.endpoint;
  if (!endpoint) return [];
  const url = new URL(endpoint, typeof window !== "undefined" ? window.location.href : "http://localhost/");
  url.searchParams.set("state", "1");
  const response = await fetchImpl(url, { headers:{ Accept:"application/json" } });
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload?.state) ? payload.state : [];
}

export function getRookSyncBridge() {
  return globalThis.rookSyncBridge || null;
}


function emailText(message = {}) {
  return [message.subject, message.snippet, message.body].filter(Boolean).join(" ");
}

function inferredPropertyFromEmail(message = {}) {
  const text = emailText(message);
  const match = text.match(/\b(\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Way|Blvd|Boulevard|Pl|Place|Cir|Circle)(?:\s*#\s*[A-Za-z0-9-]+)?)(?=\b|,)/i);
  if (!match) return null;
  const address = match[1].replace(/\s+/g, " ").trim();
  return {
    id:"email-" + address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    label:address,
    address,
    type:"Property",
    listingType:"rent",
    saved:true,
    status:"new",
    source:"Gmail",
    metadata:{ emailDiscovered:true }
  };
}

function unquotedEmailText(message = {}) {
  const body = String(message.body || "");
  const cut = body.search(/(?:^|\n)\s*On .{0,240}wrote:\s*|(?:^|\n)\s*>/i);
  const currentBody = cut >= 0 ? body.slice(0, cut) : body;
  return [message.subject, message.snippet, currentBody].filter(Boolean).join(" ");
}

function tourProposalText(message = {}) {
  const body = String(message.body || "");
  const quoted = body.match(/(?:^|\n)\s*On .{0,240}wrote:\s*([\s\S]*)$/i)?.[1] || "";
  return [unquotedEmailText(message), quoted].filter(Boolean).join(" ");
}

function inferConfirmedTour(message = {}) {
  const currentText = unquotedEmailText(message);
  // Confirmation must come from the current message, never from quoted history.
  if (!/(?:\bsee you\b|\bworks(?:\s+for\s+me)?\b|\bsounds good\b|\bconfirmed\b|\bscheduled\b|\bbooked\b)/i.test(currentText)) return null;
  const text = tourProposalText(message);
  // Prefer appointment-like times near scheduling language, which avoids reply-header timestamps.
  const candidates = [...text.matchAll(/\b(?:at\s*)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/gi)];
  const timeMatch = candidates.find(match => {
    const around = text.slice(Math.max(0, match.index - 45), Math.min(text.length, match.index + match[0].length + 70));
    return /(?:this|next)?\s*(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|showing|tour|property|works|see you/i.test(around)
      && !/(?:^|\s)(?:On|at)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+.{0,45}$/i.test(text.slice(Math.max(0, match.index - 70), match.index));
  }) || candidates[0];
  if (!timeMatch) return null;
  const base = message.occurredAt ? new Date(message.occurredAt) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const lower = text.toLowerCase();
  const weekdays = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  let targetDay = weekdays.findIndex(day => new RegExp("\\b(?:this\\s+|next\\s+)?" + day + "\\b", "i").test(text));
  if (targetDay < 0) return null;
  const date = new Date(base);
  let delta = (targetDay - date.getDay() + 7) % 7;
  if (/\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(lower)) delta = delta === 0 ? 7 : delta + 7;
  date.setDate(date.getDate() + delta);
  let hour = Number(timeMatch[1]) % 12;
  if (timeMatch[3].toLowerCase() === "pm") hour += 12;
  date.setHours(hour, Number(timeMatch[2] || 0), 0, 0);
  if (date.getTime() < base.getTime() - 5 * 60 * 1000) return null;
  return { startsAt:date.toISOString(), status:"confirmed", confidence:"confirmed" };
}

export async function scanHousingEmail(properties = [], options = {}) {
  const bridge = getRookSyncBridge();
  const payload = bridge?.scanEmail
    ? await bridge.scanEmail({
        since: options.since || null,
        propertyHints: properties.map(p => ({ id:p.id, label:p.label, address:p.address }))
      })
    : await scanGmailInBrowser(options);
  if (!payload?.connected && payload?.setupRequired) return { connected:false, setupRequired:true, scanned:0, updates:[], review:[], lastScanAt:null };
  if (!payload?.connected && !Array.isArray(payload?.messages)) return { connected:false, scanned:0, updates:[], review:[], lastScanAt:null };
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const updates = [];
  const review = [];
  for (const message of messages) {
    const property = matchEmailToProperty(message, properties) || inferredPropertyFromEmail(message);
    if (!property) continue;
    const event = normalizeEmailEvent({ ...message, propertyId:property.id });
    const kind = event.kind || classifyHousingEmail(message);
    const inferredTour = inferConfirmedTour(message);
    const tour = message.tour || (message.startsAt ? { startsAt:message.startsAt, endsAt:message.endsAt, status:message.status, confidence:message.confidence } : null) || inferredTour;
    const confidence = message.confidence || tour?.confidence || "possible";
    const inferredKind = inferredTour ? "showing-scheduled" : kind;
    if (inferredKind === "showing-scheduled" && tour?.startsAt && confidence === "confirmed") {
      updates.push({
        propertyId:property.id,
        kind:inferredKind,
        property:applyTour(applyEvidence(property, { ...event, kind:inferredKind, startsAt:tour.startsAt }), {
          ...normalizeTour({ ...tour, propertyId:property.id, source:"email", sourceMessageId:message.id, sourceThreadId:message.threadId }, options.preferences),
          sourceMessageId:message.id,
          sourceThreadId:message.threadId
        }, options.preferences),
        email:event
      });
    } else if (["showing-scheduled","showing-rescheduled","showing-cancelled","showing-proposed"].includes(kind)) {
      review.push({ propertyId:property.id, kind, email:event, tour, confidence });
    } else {
      updates.push({ propertyId:property.id, kind, property:applyEvidence(property, { ...event, kind }), email:event });
    }
  }
  return {
    connected:true,
    scanned:messages.length,
    updates,
    review,
    cursor:payload?.cursor || options.since || null,
    lastScanAt:new Date().toISOString()
  };
}

export async function reconcileTourCalendar(property, tour, options = {}) {
  const bridge = getRookSyncBridge();
  if (!bridge?.upsertCalendarEvent) return { connected:false, tour };
  const result = await bridge.upsertCalendarEvent({
    property:{ id:property.id, label:property.label, address:property.address, sourceUrl:property.sourceUrl },
    tour,
    reminderMinutes:tour.reminderMinutes,
    durationMinutes:tour.durationMinutes,
    existingEventId:tour.calendarEventId || null
  });
  return {
    connected:true,
    tour:{ ...tour, calendarEventId:result?.eventId || tour.calendarEventId || null, calendarUrl:result?.url || tour.calendarUrl || null }
  };
}
