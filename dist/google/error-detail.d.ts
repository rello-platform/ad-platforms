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
import type { PlatformErrorDetail } from "../types.js";
export type GoogleFieldViolation = NonNullable<PlatformErrorDetail["fieldViolations"]>[number];
export declare const PLATFORM_TEXT_MAX = 300;
export declare const FIELD_VIOLATIONS_MAX = 10;
export declare const FIELD_SEGMENT_MAX = 40;
/** The field path when it is shaped like one and every segment is plausible; otherwise `<unrecognized_field>`. */
export declare function maskFieldPath(v: unknown): string;
/**
 * A Google error `reason` (a BadRequest field violation's, or an ErrorInfo's): kept only when it is UPPER_SNAKE AND either shorter
 * than 24 characters or exactly a listed Google name, the same rule the text has (GD-3571). An UPPER_SNAKE value that is neither
 * reads `<token>`, so the key stays and a reader sees a reason existed. A value that is not UPPER_SNAKE text is left out.
 */
export declare function maskReason(v: unknown): string | undefined;
/**
 * An ErrorInfo `domain`: kept only when it is exactly a listed Google error domain (GD-3572, `known-domains.ts`); any other
 * non-blank text reads `<unrecognized_domain>`; blank or not text is left out.
 */
export declare function maskDomain(v: unknown): string | undefined;
/** Masks identifiers and secrets in platform text, then cuts it. Never throws; a non-string gives undefined. */
export declare function maskPlatformText(v: unknown): string | undefined;
/**
 * The masked detail of one Google error body, or just the HTTP status when the body is not Google's error shape.
 * `canonical` is the caller's set of gRPC codes. Never throws.
 */
export declare function googleErrorDetail(httpStatus: number, body: unknown, canonical: ReadonlySet<string>): PlatformErrorDetail;
//# sourceMappingURL=error-detail.d.ts.map