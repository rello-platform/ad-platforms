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
 *                     `description` masked and cut like the message; a `reason` is kept only when UPPER_SNAKE and either
 *                     under 24 characters or a listed name, else `<token>` (GD-3571);
 *   errorInfo         from a `google.rpc.ErrorInfo` detail: `reason` (as above) and `domain` (only a listed Google error domain,
 *                     `known-domains.ts`, else `<unrecognized_domain>`; GD-3572) only.
 *
 * MASKED means control characters are dropped, then EVERY run of 24+ characters from the token alphabet
 * (`A-Z a-z 0-9 _ - + / =`) is replaced whole, first, before any other rule can split it (AUDIT 163, GD-3505): an exact
 * UUID → `<id>`, all hex → `<hex>`, anything else → `<token>`, whatever its mix of letters and digits (a run of letters
 * only is masked too, and so is one shaped like camelCase or snake_case: shape is not a name, GD-3509). A run stays readable only when
 * it is EXACTLY a name in `known-names.ts` (Google's published error-reason names, and the field and quota names this package
 * handles; every entry sourced there). Then e-mail addresses (a masked run inside one still makes the whole address `<email>`),
 * hex of 16+, phone-like digit runs and digit runs of 6+ become `<email>` / `<hex>` / `<id>`, all BEFORE the cut.
 * Natural-language words are under 24 characters and pass: they are the diagnosis. A `field` is kept only when every
 * segment is a plausible API field name (FIELD_PATH's shape, at most 40 characters, and, judged WHOLE with its underscores
 * ignored, neither 24+ letters-and-digits nor 16+ mixing letters and digits unless the segment is a listed name, GD-3506 and
 * GD-3508); otherwise it is `<unrecognized_field>`. A customer id, a list id, a hashed identifier, an access token or an address
 * Google echoes back therefore never reaches a returned field. The outcome's `reason` stays the fixed code: logs that
 * print `reason` are unchanged. `detail` is the only place platform text goes, and only in this masked form.
 */
import { GOOGLE_KNOWN_DOMAINS } from "./known-domains.js";
import { GOOGLE_KNOWN_NAMES } from "./known-names.js";
export const PLATFORM_TEXT_MAX = 300;
export const FIELD_VIOLATIONS_MAX = 10;
const UPPER_SNAKE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FIELD_PATH = /^[A-Za-z_][A-Za-z0-9_]{0,63}(\[\d{1,6}\])?(\.[A-Za-z_][A-Za-z0-9_]{0,63}(\[\d{1,6}\])?){0,15}$/;
export const FIELD_SEGMENT_MAX = 40;
const OPAQUE_RUN = /[A-Za-z0-9_\-+/=]{24,}/g;
const EXACT_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** One opaque run's mask: whole, never split. */
function maskRun(run) {
    // A long run stays readable only when it IS a listed Google name; casing and underscores say nothing (GD-3509).
    if (GOOGLE_KNOWN_NAMES.has(run))
        return run;
    if (EXACT_UUID.test(run))
        return "<id>";
    if (/^[0-9a-fA-F]+$/.test(run))
        return "<hex>";
    return "<token>";
}
/**
 * True when `name` (one path segment, index stripped) is a plausible API field name. The segment is judged WHOLE, its
 * underscores and hyphens ignored, so a long opaque value cannot pass by being cut into short pieces (GD-3508):
 * a listed Google name is kept; otherwise 24+ letters-and-digits are opaque, and so are 16+ that mix letters and digits.
 */
function plausibleSegment(name) {
    if (name.length > FIELD_SEGMENT_MAX)
        return false;
    if (GOOGLE_KNOWN_NAMES.has(name))
        return true;
    const content = name.replace(/[_-]/g, "");
    if (content.length >= 24)
        return false;
    return !(content.length >= 16 && /\d/.test(content) && /[A-Za-z]/.test(content));
}
/** The field path when it is shaped like one and every segment is plausible; otherwise `<unrecognized_field>`. */
export function maskFieldPath(v) {
    if (typeof v !== "string" || v.length > 200 || !FIELD_PATH.test(v))
        return "<unrecognized_field>";
    return v.split(".").every((seg) => plausibleSegment(seg.replace(/\[\d{1,6}\]$/, ""))) ? v : "<unrecognized_field>";
}
/**
 * A Google error `reason` (a BadRequest field violation's, or an ErrorInfo's): kept only when it is UPPER_SNAKE AND either shorter
 * than 24 characters or exactly a listed Google name, the same rule the text has (GD-3571). An UPPER_SNAKE value that is neither
 * reads `<token>`, so the key stays and a reader sees a reason existed. A value that is not UPPER_SNAKE text is left out.
 */
export function maskReason(v) {
    if (typeof v !== "string" || !UPPER_SNAKE.test(v))
        return undefined;
    return v.length < 24 || GOOGLE_KNOWN_NAMES.has(v) ? v : "<token>";
}
/**
 * An ErrorInfo `domain`: kept only when it is exactly a listed Google error domain (GD-3572, `known-domains.ts`); any other
 * non-blank text reads `<unrecognized_domain>`; blank or not text is left out.
 */
export function maskDomain(v) {
    if (typeof v !== "string" || v === "")
        return undefined;
    return GOOGLE_KNOWN_DOMAINS.has(v) ? v : "<unrecognized_domain>";
}
/** Masks identifiers and secrets in platform text, then cuts it. Never throws; a non-string gives undefined. */
export function maskPlatformText(v) {
    if (typeof v !== "string")
        return undefined;
    const masked = v
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        // Opaque runs FIRST, whole, so no later rule can split one and leave a fragment (GD-3505).
        .replace(OPAQUE_RUN, maskRun)
        // An address, even one with a masked run inside it, goes whole.
        .replace(/[A-Za-z0-9._%+<>-]+@[A-Za-z0-9<>-]+(\.[A-Za-z0-9<>-]+)+/g, "<email>")
        .replace(/[0-9a-fA-F]{16,}/g, "<hex>")
        .replace(/\+?\d[\d ().-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "<id>" : m))
        .replace(/\d{6,}/g, "<id>")
        .replace(/\s+/g, " ")
        .trim();
    if (masked === "")
        return undefined;
    return masked.length > PLATFORM_TEXT_MAX ? `${masked.slice(0, PLATFORM_TEXT_MAX - 1)}…` : masked;
}
const isType = (d, suffix) => typeof d?.["@type"] === "string" && String(d["@type"]).endsWith(suffix);
/**
 * The masked detail of one Google error body, or just the HTTP status when the body is not Google's error shape.
 * `canonical` is the caller's set of gRPC codes. Never throws.
 */
export function googleErrorDetail(httpStatus, body, canonical) {
    const out = { httpStatus };
    try {
        const e = body?.error;
        if (!e || typeof e !== "object")
            return out;
        if (typeof e.status === "string" && canonical.has(e.status))
            out.status = e.status;
        const message = maskPlatformText(e.message);
        if (message)
            out.message = message;
        const details = Array.isArray(e.details) ? e.details : [];
        const violations = [];
        for (const d of details) {
            if (!isType(d, "google.rpc.BadRequest"))
                continue;
            const fvs = d.fieldViolations;
            for (const fv of Array.isArray(fvs) ? fvs : []) {
                if (violations.length >= FIELD_VIOLATIONS_MAX)
                    break;
                const f = fv;
                const v = { field: maskFieldPath(f.field) };
                const reason = maskReason(f.reason);
                if (reason !== undefined)
                    v.reason = reason;
                const description = maskPlatformText(f.description);
                if (description)
                    v.description = description;
                violations.push(v);
            }
        }
        if (violations.length)
            out.fieldViolations = violations;
        const info = details.find((d) => isType(d, "google.rpc.ErrorInfo"));
        if (info) {
            const ei = {};
            const reason = maskReason(info.reason);
            if (reason !== undefined)
                ei.reason = reason;
            const domain = maskDomain(info.domain);
            if (domain !== undefined)
                ei.domain = domain;
            if (ei.reason || ei.domain)
                out.errorInfo = ei;
        }
    }
    catch {
        // A body shaped to throw on access keeps only the status: never a crash, never its text.
    }
    return out;
}
