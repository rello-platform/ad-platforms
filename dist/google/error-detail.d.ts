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
export declare const PLATFORM_TEXT_MAX = 300;
export declare const FIELD_VIOLATIONS_MAX = 10;
/** Masks identifiers and secrets in platform text, then cuts it. Never throws; a non-string gives undefined. */
export declare function maskPlatformText(v: unknown): string | undefined;
/**
 * The masked detail of one Google error body, or just the HTTP status when the body is not Google's error shape.
 * `canonical` is the caller's set of gRPC codes. Never throws.
 */
export declare function googleErrorDetail(httpStatus: number, body: unknown, canonical: ReadonlySet<string>): PlatformErrorDetail;
//# sourceMappingURL=error-detail.d.ts.map