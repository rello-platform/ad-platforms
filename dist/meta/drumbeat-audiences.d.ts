export declare const DRUMBEAT_GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
/** The numeric ad-account id, given either Meta form. */
export declare function canonicalMetaAdAccountId(id: string): string;
/** The Graph path segment for a stored ad-account id: always `act_<numeric>`. */
export declare function metaAdAccountNode(storedAccountId: string): string;
export interface AudienceMember {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    city?: string;
    state?: string;
    zip?: string;
}
/**
 * Meta Custom Audience schema keys this app can supply, in a fixed canonical
 * order. `data` rows are positionally aligned to the emitted `schema` array —
 * NOT keyed objects. Per Meta's Custom Audience user-upload reference:
 *
 *   { "schema": ["FN","LN","EMAIL"],
 *     "data": [["<hash>","<hash>","<hash>"], ...] }
 *
 * Every key below is in Meta's "hashing required" set. Only MADID / EXTERN_ID /
 * app-user-id / page-scoped-user-id are sent unhashed, and this app sends none
 * of them — so every value we emit is a SHA-256 hex digest.
 */
declare const META_SCHEMA_FIELDS: readonly ["EMAIL", "PHONE", "FN", "LN", "CT", "ST", "ZIP"];
export type MetaSchemaField = (typeof META_SCHEMA_FIELDS)[number];
export interface MetaAudiencePayload {
    /** Ordered schema keys — only the fields at least one member supplies. */
    schema: MetaSchemaField[];
    /** Rows of SHA-256 hex digests, positionally aligned to `schema`. */
    data: string[][];
    /** Members dropped because they normalized to no usable identifier. */
    skipped: number;
}
/**
 * Project audience members into Meta's positional `schema` / `data` upload
 * shape. Exported for unit test — this is the contract the whole upload rests
 * on, so it is asserted directly rather than through a mocked fetch.
 *
 * Columns no member supplies are omitted entirely: uploading an all-empty ZIP
 * column costs bytes and matches nothing.
 */
export declare function projectMembersToMetaPayload(members: AudienceMember[]): MetaAudiencePayload;
/**
 * Create a custom audience via Meta Graph API.
 */
export declare function createMetaCustomAudience(credentials: {
    accessToken: string;
    adAccountId: string;
}, name: string, description: string): Promise<{
    externalAudienceId: string;
}>;
/**
 * Upload hashed member data to a custom audience in batches of 10k.
 */
export declare function syncAudienceMembers(credentials: {
    accessToken: string;
}, externalAudienceId: string, members: AudienceMember[]): Promise<{
    uploaded: number;
    batches: number;
}>;
export {};
//# sourceMappingURL=drumbeat-audiences.d.ts.map