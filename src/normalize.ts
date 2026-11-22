/**
 * Per-platform normalization and SHA-256 (S12 design §4.3), for the NEW clients.
 * The Drumbeat's moved audience clients keep their own private normalizers, byte-for-byte
 * (src/meta/drumbeat-audiences.ts, src/google/drumbeat-customer-match.ts).
 *
 * Rules, from the platforms' own pages (read 2026-11-22; README "Sources"):
 * - Meta `em`: "Trim any leading and trailing spaces. Convert all characters to lowercase."
 *   No Gmail rule is stated, so dots and +tags are kept.
 * - Meta `ph`: "Remove symbols, letters, and any leading zeros." Include a country code: Meta's own
 *   example normalizes (650)555-1212 to 16505551212.
 * - Google email: lowercase; "Trim leading, trailing and intermediate whitespace"; for gmail.com and
 *   googlemail.com "Remove all dots (.) before the @ symbol" and "Remove the plus sign (+) from the
 *   local-part and remove all characters that follow it". Other domains keep dots and plus signs.
 * - Google phone: "Use E.164 format. Include the plus sign (+) and the country code."
 * - Hash: SHA-256, lowercase hex (Data Manager `encoding: HEX`; Google: hex case "doesn't matter").
 *
 * A value that cannot be normalized returns null and is left out. It is never hashed as junk.
 */
import { createHash } from "node:crypto";
import type { HashedMember, Platform } from "./types.js";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(platform: Platform, raw: string): string | null {
  if (typeof raw !== "string") return null;
  let v: string;
  if (platform === "META") {
    v = raw.trim().toLowerCase();
  } else {
    v = raw.replace(/\s+/g, "").toLowerCase();
    const at = v.lastIndexOf("@");
    if (at > 0) {
      const domain = v.slice(at + 1);
      if (GMAIL_DOMAINS.has(domain)) {
        let local = v.slice(0, at);
        const plus = local.indexOf("+");
        if (plus >= 0) local = local.slice(0, plus);
        local = local.replace(/\./g, "");
        v = `${local}@${domain}`;
      }
    }
  }
  return EMAIL_SHAPE.test(v) ? v : null;
}

/** Rello and ClearPath sell in the US: a bare 10-digit national number gets +1. */
const DEFAULT_COUNTRY_CODE = "1";

/**
 * Meta: digits with the country code, no plus. Google: E.164 with the plus.
 * A number written with `+` or `00` is international as given. A number without either is accepted
 * only when it is unambiguous: 10 national digits (the default country code is added), or the
 * default country code followed by 10 digits. Anything else returns null rather than a guessed hash.
 */
export function normalizePhone(platform: Platform, raw: string, opts: { defaultCountryCode?: string } = {}): string | null {
  if (typeof raw !== "string") return null;
  const cc = opts.defaultCountryCode ?? DEFAULT_COUNTRY_CODE;
  if (!/^[1-9]\d{0,2}$/.test(cc)) throw new Error("normalizePhone: defaultCountryCode must be 1-3 digits");
  const trimmed = raw.trim();
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "").replace(/^0+/, "");
  if (!international) {
    if (digits.length === 10) digits = cc + digits;
    else if (!(digits.length === 10 + cc.length && digits.startsWith(cc))) return null;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return platform === "META" ? digits : `+${digits}`;
}

/** Normalizes and hashes one person's identifiers for ONE platform. Null when nothing usable is left. */
export function hashMember(
  platform: Platform,
  input: { email?: string | null; phone?: string | null },
  opts: { defaultCountryCode?: string } = {},
): HashedMember | null {
  const email = input.email ? normalizeEmail(platform, input.email) : null;
  const phone = input.phone ? normalizePhone(platform, input.phone, opts) : null;
  if (!email && !phone) return null;
  return { ...(email ? { email: sha256Hex(email) } : {}), ...(phone ? { phone: sha256Hex(phone) } : {}) };
}

/** Meta `external_id` (§4.3 Rev 5): SHA-256 of `<tenantId>:<leadId or userId>`. */
export function hashExternalId(tenantId: string, subjectId: string): string {
  if (typeof tenantId !== "string" || tenantId.trim() === "") throw new Error("hashExternalId: tenantId is required");
  if (typeof subjectId !== "string" || subjectId.trim() === "") throw new Error("hashExternalId: subjectId is required");
  return sha256Hex(`${tenantId}:${subjectId}`);
}
