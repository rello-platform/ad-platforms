/**
 * MOVED from The-Drumbeat `src/lib/google/audiences.ts` and `src/lib/google/customer-id.ts`
 * @ 960ea5e629bbdbf2b7fa505a4f3b2521f1b6843d (S12a), behaviour unchanged. The ONLY change: the
 * Prisma connection lookup and `getGoogleAccessToken` stay in the Drumbeat, which now passes
 * `{ accessToken, developerToken, apiBase, accountId }` in (apiBase = its GOOGLE_ADS_API_BASE).
 *
 * This is the Google Ads API offlineUserDataJobs path the Drumbeat uses. Rello's S12 Customer
 * Match client is the Data Manager API (`./client.ts`): new integrations must use Data Manager.
 */
import type { AudienceMember } from "../meta/drumbeat-audiences.js";
export interface GoogleAdsApiCredentials {
    accessToken: string;
    /** The Drumbeat's GOOGLE_ADS_DEVELOPER_TOKEN_VALUE. */
    developerToken: string;
    /** The Drumbeat's GOOGLE_ADS_API_BASE. */
    apiBase: string;
    /** `AdAccountConnection.accountId` for the GOOGLE row. */
    accountId: string;
}
export declare function parseGoogleAdsCustomerId(value: unknown): string | null;
export declare function googleAdsCustomerPath(apiBase: string, accountId: string): string;
/**
 * Create a Customer Match (CRM-based) user list via userLists:mutate.
 * Returns the resource name (`customers/<cid>/userLists/<id>`) as the
 * externalAudienceId, matching the Meta-side return shape.
 */
export declare function createGoogleCustomerMatchAudience(credentials: GoogleAdsApiCredentials, name: string, description: string): Promise<{
    externalAudienceId: string;
}>;
/**
 * Upload hashed member data to a Customer Match user list via the
 * offlineUserDataJobs flow: create job → addOperations (100k batches) → run.
 * Mirrors the Meta-side `{ uploaded, batches }` return shape.
 *
 * Idempotent at the platform level — Google's Customer Match member set is
 * additive (re-uploading the same hashed identifiers is a no-op for set size),
 * so trigger-level retries are safe.
 */
export declare function syncGoogleAudienceMembers(credentials: GoogleAdsApiCredentials, externalAudienceId: string, members: AudienceMember[]): Promise<{
    uploaded: number;
    batches: number;
}>;
//# sourceMappingURL=drumbeat-customer-match.d.ts.map