import { type HttpResult } from "../http.js";
import { type AdOutcome, type AdPlatformClient, type Sleep } from "../types.js";
export declare const META_DEFAULT_API_BASE = "https://graph.facebook.com";
/** v21.0: the version the Drumbeat's Meta surfaces already use (live until 2027-01-21 per its note). */
export declare const META_DEFAULT_API_VERSION = "v21.0";
/** "You can add up to 10,000 people to an audience at a given time." */
export declare const META_MEMBER_BATCH_LIMIT = 10000;
/** Meta allows at most 1,000 events per Conversions API request. */
export declare const META_EVENTS_PER_REQUEST_LIMIT = 1000;
export interface MetaClientConfig {
    accessToken: string;
    /** Graph base WITHOUT the version, e.g. https://graph.facebook.com (tests: the fake's metaBase). */
    apiBase?: string;
    apiVersion?: string;
    /** Our list key → Meta custom audience id. A list with no id is not_connected. */
    audienceIds?: Record<string, string>;
}
export interface MetaClientOptions {
    timeoutMs?: number;
    batchSize?: number;
    /** Wait between `operation_status` reads after a replace. */
    statusPollMs?: number;
    statusMaxReads?: number;
    sleep?: Sleep;
}
export interface MetaConversionInput {
    /** `CompleteRegistration` (signup), `Lead`, or a neutral custom name (`FundedLoan`), §4.3. */
    eventName: string;
    eventTime: Date;
    /** `rello:<conversionKey>`, stable across retries. */
    eventId: string;
    email?: string | null;
    phone?: string | null;
    externalId?: {
        tenantId: string;
        subjectId: string;
    };
    /** Click ids are NOT hashed (Meta: fbc/fbp "Do not hash"). */
    fbc?: string | null;
    fbp?: string | null;
    value?: {
        amount: number;
        currency: string;
    };
    eventSourceUrl?: string;
}
/**
 * Builds the Conversions API request object for `freezeBatch`. Hashing happens here, once; the
 * frozen bytes are then never rebuilt. Events keep the caller's order (the ledger orders them by
 * conversionKey, §4.5 Rev 3 item 2).
 */
export declare function buildMetaConversionRequest(config: {
    apiBase?: string;
    apiVersion?: string;
    datasetId: string;
}, events: MetaConversionInput[]): {
    endpoint: string;
    apiVersion: string;
    request: {
        data: Array<Record<string, unknown>>;
    };
};
/** The Meta Conversions API classes (§4.5 Rev 3 item 3). Exported for tests. */
export declare function classifyMetaConversion(r: HttpResult): AdOutcome;
export declare function createMetaClient(config: MetaClientConfig, options?: MetaClientOptions): AdPlatformClient;
//# sourceMappingURL=client.d.ts.map