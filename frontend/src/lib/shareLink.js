/**
 * URL-based session sharing — no backend required.
 *
 * Encodes { session, profile, created_at } as URL-safe base64 of UTF-8 JSON
 * and decodes it back. Used to power the /s page on any static host
 * (Netlify, Vercel, GitHub Pages).
 *
 * Expiry: callers embed `created_at` and read it back to enforce a 30-day
 * window client-side.
 */

const TTL_DAYS = 30;

function utf8ToBase64Url(str) {
  // Convert UTF-8 string -> base64 -> URL-safe variant
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUtf8(str) {
  const padded = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(str.length / 4) * 4, "=");
  return decodeURIComponent(escape(atob(padded)));
}

export function encodeShare(payload) {
  const data = {
    ...payload,
    created_at: payload.created_at || new Date().toISOString(),
    ttl_days: TTL_DAYS,
  };
  return utf8ToBase64Url(JSON.stringify(data));
}

export function decodeShare(encoded) {
  if (!encoded) throw new Error("Empty share data");
  const json = base64UrlToUtf8(encoded);
  return JSON.parse(json);
}

export function isExpired(createdAtIso, ttlDays = TTL_DAYS) {
  if (!createdAtIso) return false;
  const created = new Date(createdAtIso).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() > created + ttlDays * 86400 * 1000;
}

export function expiresOn(createdAtIso, ttlDays = TTL_DAYS) {
  if (!createdAtIso) return null;
  const created = new Date(createdAtIso).getTime();
  if (Number.isNaN(created)) return null;
  return new Date(created + ttlDays * 86400 * 1000);
}

export const SHARE_TTL_DAYS = TTL_DAYS;
