/**
 * The Data Manager API `ProcessingErrorReason` enum names, copied from Google's published reference:
 *   https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve#ProcessingErrorReason
 *   read 2026-11-22 (22:13Z, prompt 1687): 50 names, in the page's order. The page says "New reasons may be
 *   added in the future."
 *
 * GD-2960 (audit 136): a request-status error reason reaches a returned field or an outcome reason only when it
 * is IN this set; anything else (including a reason Google adds later) reads UNRECOGNIZED_REASON. Membership,
 * not a shape check: text with the enum's shape is still platform text. A later name changes only the
 * reason text, never an outcome status. Note one name, PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER,
 * has no `_REASON_` infix, as Google writes it.
 */
export declare const GOOGLE_PROCESSING_ERROR_REASONS: ReadonlySet<string>;
//# sourceMappingURL=processing-error-reasons.d.ts.map