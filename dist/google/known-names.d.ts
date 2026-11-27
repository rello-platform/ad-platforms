/**
 * The long Google names that stay readable in a masked error detail (AUDIT 163 round 2, GD-3509; Platform KA prompt 2159).
 *
 * A run of 24+ characters in Google's error text is masked whole (src/google/error-detail.ts) UNLESS it is exactly one of
 * the names below. Letter casing or underscores say nothing about whether a run is a name: an arbitrary 32-letter value
 * can be shaped like camelCase or snake_case, so shape never keeps a run. Membership does. A name Google adds later reads
 * `<token>` until it is added here, the same trade GD-2960 made for request-status reasons (`processing-error-reasons.ts`).
 *
 * Only names of 24+ characters need an entry; a shorter one is never masked as a run. Sources, each read in full:
 *
 *   1. ProcessingErrorReason, 50 names: the set this package already carries (`GOOGLE_PROCESSING_ERROR_REASONS`, read
 *      2026-11-22 from the Data Manager reference, `requestStatus/retrieve#ProcessingErrorReason`). Used by reference.
 *   2. ErrorReason, the names of 24+ characters: https://developers.google.com/data-manager/api/reference/rest/v1/ErrorReason
 *      read 2026-11-27 (135 values on the page, 77 at 24+ characters). Listed below in the page's order.
 *   3. Request field names this package sends, written in JSON camelCase by `src/google/client.ts` (`termsOfService.
 *      customerMatchTermsOfServiceStatus` :350, `requestStatusPerDestination` :303; the Data Manager `ingest` reference,
 *      https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/ingest, read 2026-11-27, shows the
 *      first) and by `src/google/drumbeat-customer-match.ts` :216 (`customerMatchUserListMetadata`, the Google Ads API
 *      UserList field). Google's error text names a proto field in snake_case, the protobuf JSON mapping of the same name,
 *      so those three are also listed snake_case.
 *   4. `remove_all_audience_members`: the field Google's own error text named in the S13 refusal of `audienceMembers:removeAll`
 *      (DISCOVERED-RELLO-ADS-PLATFORMS-V010-AUDIT-136-FOLLOW-UPS-261122, 2026-11-27 append; kept as the audited fixture
 *      since AUDIT 163 round 1). NOT on the public reference pages (checked 2026-11-27): it is listed because Google said it.
 *   5. Quota limit names this package matches in an ErrorInfo (`client.ts` :213, :215): they appear in Google's message text.
 *   6. `TERMS_OF_SERVICE_STATUS_UNSPECIFIED`: the TermsOfServiceStatus enum on the same `ingest` page.
 */
/** The names a masked run may equal, case-sensitive and whole. */
export declare const GOOGLE_KNOWN_NAMES: ReadonlySet<string>;
//# sourceMappingURL=known-names.d.ts.map