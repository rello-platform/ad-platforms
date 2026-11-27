/**
 * v0.2.0 (Platform KA prompt 2138; S13): what a refused Google request said, kept so it can be diagnosed.
 *
 * Until v0.2.0 a Google error kept only a fixed code (`google_INVALID_ARGUMENT`), which is what GD-2954 asked of
 * free platform text. At S13 both audience replaces were refused that way and nothing said which field
 * (DISCOVERED-RELLO-ADS-PLATFORMS-V010-AUDIT-136-FOLLOW-UPS-261122, 2026-11-27 append). Now the outcome also carries
 * `detail`, built here and nowhere else:
 *
 *   httpStatus        the HTTP status (a number);
 *   status            the body's `error.status`, only when it is a gRPC canonical code;
 *   message           Google's `error.message`, MASKED and cut to 300 characters;
 *   fieldViolations   from a `google.rpc.BadRequest` detail, at most 10: `field` only when it has a field-path shape
 *                     (`destinations[0].productDestinationId`), `reason` only when it is an UPPER_SNAKE name,
 *                     `description` masked and cut like the message;
 *   errorInfo         from a `google.rpc.ErrorInfo` detail: `reason` (UPPER_SNAKE) and `domain` (a host name) only.
 *
 * MASKED means every e-mail address, UUID, opaque token (a run of 24+ characters mixing letters and digits), hex
 * string of 16+, phone-like digit run and digit run of 6+ is replaced by `<email>` / `<id>` / `<token>` / `<hex>`, in
 * that order (an opaque run is replaced whole, so no fragment of it is left), and control characters are dropped, all
 * BEFORE the cut. Plain words pass: they are the diagnosis. A customer id, a list id, a hashed identifier, an access token or an address
 * Google echoes back therefore never reaches a returned field. The outcome's `reason` stays the fixed code: logs that
 * print `reason` are unchanged. `detail` is the only place platform text goes, and only in this masked form.
 */

import type { PlatformErrorDetail } from "../types.js";

export type GoogleFieldViolation = NonNullable<PlatformErrorDetail["fieldViolations"]>[number];

export const PLATFORM_TEXT_MAX = 300;
export const FIELD_VIOLATIONS_MAX = 10;

const UPPER_SNAKE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FIELD_PATH = /^[A-Za-z_][A-Za-z0-9_]{0,63}(\[\d{1,6}\])?(\.[A-Za-z_][A-Za-z0-9_]{0,63}(\[\d{1,6}\])?){0,15}$/;
const DOMAIN = /^[a-z0-9][a-z0-9.-]{0,99}$/;

/** Masks identifiers and secrets in platform text, then cuts it. Never throws; a non-string gives undefined. */
export function maskPlatformText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const masked = v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g, "<email>")
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<id>")
    // Opaque runs first, whole, so no later rule leaves a fragment of one behind.
    .replace(/[A-Za-z0-9_\-+/=]{24,}/g, (m) => (/^[0-9a-fA-F]+$/.test(m) ? "<hex>" : /\d/.test(m) && /[A-Za-z]/.test(m) ? "<token>" : m))
    .replace(/[0-9a-fA-F]{16,}/g, "<hex>")
    .replace(/\+?\d[\d ().-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "<id>" : m))
    .replace(/\d{6,}/g, "<id>")
    .replace(/\s+/g, " ")
    .trim();
  if (masked === "") return undefined;
  return masked.length > PLATFORM_TEXT_MAX ? `${masked.slice(0, PLATFORM_TEXT_MAX - 1)}…` : masked;
}

const isType = (d: unknown, suffix: string) => typeof (d as { "@type"?: unknown })?.["@type"] === "string" && String((d as { "@type": string })["@type"]).endsWith(suffix);

/**
 * The masked detail of one Google error body, or just the HTTP status when the body is not Google's error shape.
 * `canonical` is the caller's set of gRPC codes. Never throws.
 */
export function googleErrorDetail(httpStatus: number, body: unknown, canonical: ReadonlySet<string>): PlatformErrorDetail {
  const out: PlatformErrorDetail = { httpStatus };
  try {
    const e = (body as { error?: unknown } | undefined)?.error as { status?: unknown; message?: unknown; details?: unknown } | undefined;
    if (!e || typeof e !== "object") return out;
    if (typeof e.status === "string" && canonical.has(e.status)) out.status = e.status;
    const message = maskPlatformText(e.message);
    if (message) out.message = message;
    const details = Array.isArray(e.details) ? e.details : [];
    const violations: GoogleFieldViolation[] = [];
    for (const d of details) {
      if (!isType(d, "google.rpc.BadRequest")) continue;
      const fvs = (d as { fieldViolations?: unknown }).fieldViolations;
      for (const fv of Array.isArray(fvs) ? fvs : []) {
        if (violations.length >= FIELD_VIOLATIONS_MAX) break;
        const f = fv as { field?: unknown; reason?: unknown; description?: unknown };
        const v: GoogleFieldViolation = { field: typeof f.field === "string" && f.field.length <= 200 && FIELD_PATH.test(f.field) ? f.field : "<unrecognized_field>" };
        if (typeof f.reason === "string" && UPPER_SNAKE.test(f.reason)) v.reason = f.reason;
        const description = maskPlatformText(f.description);
        if (description) v.description = description;
        violations.push(v);
      }
    }
    if (violations.length) out.fieldViolations = violations;
    const info = details.find((d) => isType(d, "google.rpc.ErrorInfo")) as { reason?: unknown; domain?: unknown } | undefined;
    if (info) {
      const ei: { reason?: string; domain?: string } = {};
      if (typeof info.reason === "string" && UPPER_SNAKE.test(info.reason)) ei.reason = info.reason;
      if (typeof info.domain === "string" && DOMAIN.test(info.domain)) ei.domain = info.domain;
      if (ei.reason || ei.domain) out.errorInfo = ei;
    }
  } catch {
    // A body shaped to throw on access keeps only the status: never a crash, never its text.
  }
  return out;
}
