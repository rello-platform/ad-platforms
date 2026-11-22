import { type HttpResult } from "../http.js";
import { type AdOutcome, type AdPlatformClient, type Advertiser, type RequestStatus, type Sleep } from "../types.js";
export declare const GOOGLE_DATAMANAGER_DEFAULT_API_BASE = "https://datamanager.googleapis.com";
export declare const GOOGLE_DATAMANAGER_API_VERSION = "v1";
export declare const GOOGLE_DATAMANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";
/** "At most 10000 … resources can be sent in a single request." */
export declare const GOOGLE_AUDIENCE_MEMBERS_PER_REQUEST_LIMIT = 10000;
/** "At most 2000 … resources can be sent in a single request." */
export declare const GOOGLE_EVENTS_PER_REQUEST_LIMIT = 2000;
export interface GoogleClientConfig {
    /** Called for a fresh token; credentials never reach this package as a stored value. */
    getAccessToken: () => Promise<string>;
    /** Data Manager base WITHOUT the version (tests: the fake's googleBase). */
    apiBase?: string;
    /** The Google Ads operating account (customer id; hyphens are removed). */
    operatingAccountId: string;
    loginAccountId?: string;
    /** Our list key → Customer Match user list id (`productDestinationId`). */
    userListIds?: Record<string, string>;
}
export interface GoogleClientOptions {
    timeoutMs?: number;
    batchSize?: number;
    /** Wait before each status read. Google advises waiting before the first check; tests pass 0. */
    statusPollMs?: number;
    statusMaxReads?: number;
    sleep?: Sleep;
    now?: () => Date;
}
export interface GoogleConversionInput {
    /** `rello:<conversionKey>`: "A unique identifier for the conversion event, used for deduplication." */
    transactionId: string;
    eventTime: Date;
    email?: string | null;
    phone?: string | null;
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    value?: {
        amount: number;
        currency: string;
    };
}
export interface RequestStatusDetail {
    status: RequestStatus;
    errorReasons: string[];
}
export interface GoogleAdPlatformClient extends AdPlatformClient {
    requestStatus(advertiser: Advertiser, requestId: string): Promise<RequestStatus>;
    requestStatusDetail(advertiser: Advertiser, requestId: string): Promise<RequestStatusDetail>;
}
/** Builds the `events:ingest` request object for `freezeBatch`. Hashing happens here, once. */
export declare function buildGoogleConversionRequest(config: {
    apiBase?: string;
    operatingAccountId: string;
    loginAccountId?: string;
}, input: {
    conversionActionId: string;
    events: GoogleConversionInput[];
}): {
    endpoint: string;
    apiVersion: string;
    request: Record<string, unknown>;
};
/** The next 00:00 America/Los_Angeles after `now`, as an ISO instant (the daily quota reset). */
export declare function nextMidnightPacific(now: Date): string;
/** The Google classes of §4.5 Rev 4 item 2. Exported for tests. */
export declare function classifyGoogleResponse(r: HttpResult, now: Date): AdOutcome;
/** Maps a conversion batch's request status to an outcome (a repeated transactionId is `duplicate`, §4.5 Rev 2). */
export declare function conversionOutcomeFromStatus(d: RequestStatusDetail): AdOutcome;
export declare function createGoogleClient(config: GoogleClientConfig, options?: GoogleClientOptions): GoogleAdPlatformClient;
//# sourceMappingURL=client.d.ts.map