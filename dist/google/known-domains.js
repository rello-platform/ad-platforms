/**
 * The `google.rpc.ErrorInfo.domain` values that stay readable in a masked error detail (AUDIT 163 round 3, GD-3572; Platform
 * KA prompt 2183). A domain is kept only when it is EXACTLY one of these; anything else, including any host-shaped value,
 * reads `<unrecognized_domain>`. A pattern keeps nothing: a 32-letter run with no dot is "shaped like" a host name.
 *
 * Each entry and where it was read (Google's public pages, read 2026-11-27; the Google Ads pages could not be read):
 *
 *   "googleapis.com"             https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto, the ErrorInfo
 *                                `domain` comment: "For Google API infrastructure, the error domain is "googleapis.com"", and the
 *                                API_DISABLED example (`"domain": "googleapis.com"`).
 *   "datamanager.googleapis.com" The Data Manager API's registered service name: https://developers.google.com/data-manager/api/reference/rest
 *                                ("Service: datamanager.googleapis.com"). The same proto comment says "The error domain is typically the
 *                                registered service name of the tool or product that generates the error" (its example is
 *                                "pubsub.googleapis.com"). No page read shows a Data Manager error body carrying this domain, so this
 *                                entry rests on that comment and on the package's own test fixture; a different value reads
 *                                `<unrecognized_domain>` until it is added here.
 *
 * NOT listed: `googleads.googleapis.com` (the Google Ads API's service name). Its error-handling pages
 * (developers.google.com/google-ads/api/docs/best-practices/errors and .../rest/design/errors) returned 404 on 2026-11-27, so no
 * Google page was read for it, and the Data Manager client this masker serves does not call the Google Ads API. The examples in the
 * proto (`pubsub.googleapis.com`, `spanner.googleapis.com`) are other products' and are not listed.
 */
export const GOOGLE_KNOWN_DOMAINS = new Set(["googleapis.com", "datamanager.googleapis.com"]);
