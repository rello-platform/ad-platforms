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
import { GOOGLE_PROCESSING_ERROR_REASONS } from "./processing-error-reasons.js";
const ERROR_REASONS_24_PLUS = [
    "ERROR_REASON_UNSPECIFIED",
    "TOO_MANY_AUDIENCE_MEMBERS",
    "TOO_MANY_USER_IDENTIFIERS",
    "DATA_PARTNER_USER_LIST_MUTATE_NOT_ALLOWED",
    "INVALID_MOBILE_ID_FORMAT",
    "MULTIPLE_DATA_TYPES_NOT_ALLOWED",
    "DIFFERENT_LOGIN_ACCOUNTS_NOT_ALLOWED_FOR_DATA_PARTNER",
    "TERMS_AND_CONDITIONS_NOT_SIGNED",
    "INVALID_CONVERSION_ACTION_ID",
    "INVALID_CONVERSION_ACTION_TYPE",
    "ENCRYPTION_NOT_SUPPORTED",
    "DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS",
    "DESTINATION_ACCOUNT_DATA_POLICY_PROHIBITS_ENHANCED_CONVERSIONS",
    "DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED",
    "DUPLICATE_DESTINATION_REFERENCE",
    "UNSUPPORTED_OPERATING_ACCOUNT_FOR_DATA_PARTNER",
    "UNSUPPORTED_LINKED_ACCOUNT_FOR_DATA_PARTNER",
    "LINKED_ACCOUNT_ONLY_ALLOWED_WITH_DATA_PARTNER_LOGIN_ACCOUNT",
    "OPERATING_ACCOUNT_LOGIN_ACCOUNT_MISMATCH",
    "MULTIPLE_DESTINATIONS_FOR_GOOGLE_ANALYTICS_EVENT",
    "IMMUTABLE_FIELD_FOR_UPDATE",
    "CANNOT_UPDATE_DISABLED_LICENSE",
    "CANNOT_CREATE_LICENSE_FOR_SENSITIVE_USERLIST",
    "INVALID_CLIENT_ACCOUNT_ID",
    "PRICING_ONLY_ZERO_COST_ALLOWED",
    "CUSTOMER_NOT_ALLOWED_TO_CREATE_LICENSE",
    "INVALID_PRICING_END_DATE",
    "CANNOT_LICENSE_LOGICAL_LIST_WITH_LICENSED_OR_SHARED_SEGMENT",
    "MEDIA_SHARE_COST_NOT_ALLOWED_FOR_LICENSE_TYPE",
    "MEDIA_SHARE_COST_NOT_ALLOWED_FOR_CLIENT_CUSTOMER",
    "INVALID_MEDIA_SHARE_COST",
    "MEDIA_SHARE_COST_NOT_ALLOWED_FOR_NON_COMMERCE_USER_LIST",
    "COMMERCE_AUDIENCE_CAN_ONLY_BE_DIRECTLY_LICENSED",
    "DISPLAY_NAME_ALREADY_USED",
    "OWNERSHIP_REQUIRED_FOR_UPDATE",
    "USER_LIST_MUTATION_NOT_SUPPORTED",
    "SENSITIVE_USER_LIST_IMMUTABLE",
    "BILLABLE_RECORD_COUNT_IMMUTABLE",
    "ADVERTISER_NOT_ALLOWLISTED_FOR_UPLOADED_DATA",
    "UNSUPPORTED_PARTNER_AUDIENCE_SOURCE",
    "COMMERCE_PARTNER_NOT_ALLOWED",
    "UNSUPPORTED_PARTNER_AUDIENCE_INFO",
    "PARTNER_MATCH_FOR_MANAGER_ACCOUNT_DISALLOWED",
    "DATA_PARTNER_NOT_ALLOWLISTED_FOR_THIRD_PARTY_PARTNER_DATA",
    "ADVERTISER_TOS_NOT_ACCEPTED",
    "ADVERTISER_NOT_ALLOWLISTED_FOR_THIRD_PARTY_PARTNER_DATA",
    "USER_LIST_TYPE_NOT_SUPPORTED_FOR_ACCOUNT",
    "INVALID_COMMERCE_PARTNER",
    "CUSTOMER_NOT_ALLOWLISTED_FOR_COMMERCE_AUDIENCE",
    "UNSUPPORTED_USER_LIST_UPLOAD_KEY_TYPES",
    "UNSUPPORTED_INGESTED_USER_LIST_INFO_CONFIG",
    "UNSUPPORTED_ACCOUNT_TYPES_FOR_USER_LIST_TYPE",
    "UNSUPPORTED_ACCOUNT_TYPE_FOR_PARTNER_LINK",
    "MEMBERSHIP_DURATION_TOO_LONG",
    "EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED",
    "ACCOUNT_INELIGIBLE_FOR_STORE_SALES",
    "INVALID_MERCHANT_FEED_LANGUAGE_CODE",
    "INVALID_SUBDIVISION_CODE",
    "INVALID_SUBCONTINENT_CODE",
    "BOTH_CLIENT_ID_AND_APP_INSTANCE_ID_NOT_ALLOWED",
    "GOOGLE_ANALYTICS_SUBPROPERTY_OR_ROLLUP_PROPERTY_NOT_ALLOWED",
    "THIRD_PARTY_USER_DATA_NOT_ALLOWED",
    "EVENT_SOURCE_AND_DESTINATION_MISMATCH",
    "DESTINATION_ACCOUNT_TYPE_MISMATCH",
    "CUSTOM_VARIABLE_VALUE_CONTAINS_PII",
    "CUSTOM_VARIABLE_NOT_ENABLED",
    "INVALID_CUSTOM_VARIABLE_VALUE",
    "CUSTOM_VARIABLE_NOT_FOUND",
    "BASELINE_LOCATION_AUTO_DETECTION_FAILED",
    "INSIGHTS_MISSING_FOR_DIMENSION",
    "REQUIRED_PREREQUISITE_LINK_MISSING",
    "INVALID_REMOVE_AS_OF_TIME",
    "CONVERSION_ACTION_TOO_RECENTLY_CREATED",
    "INVALID_AD_IDENTIFIER_FOR_ACCOUNT",
    "UNSUPPORTED_ACCOUNT_TYPE_FOR_USER_LIST_DIRECT_LICENSE",
    "UNSUPPORTED_BASELINE_LOCATION",
    "CONVERSION_PRECEDES_CALL",
];
const FIELD_NAMES = [
    "customerMatchTermsOfServiceStatus",
    "customer_match_terms_of_service_status",
    "requestStatusPerDestination",
    "request_status_per_destination",
    "customerMatchUserListMetadata",
    "customer_match_user_list_metadata",
    "remove_all_audience_members",
];
const OTHER_NAMES = [
    "IngestionMutateRequestsPerMinutePerProject",
    "IngestionMutateRequestsPerDayPerProject",
    "TERMS_OF_SERVICE_STATUS_UNSPECIFIED",
];
/** The names a masked run may equal, case-sensitive and whole. */
export const GOOGLE_KNOWN_NAMES = new Set([
    ...GOOGLE_PROCESSING_ERROR_REASONS,
    ...ERROR_REASONS_24_PLUS,
    ...FIELD_NAMES,
    ...OTHER_NAMES,
]);
