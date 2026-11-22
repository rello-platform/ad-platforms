/**
 * `@rello-platform/ad-platforms/fake` — a local HTTP server speaking the request shapes of the Meta
 * Conversions API, Meta custom-audience users / usersreplace, the Google Data Manager API
 * (audienceMembers ingest/remove/removeAll, events ingest, requestStatus retrieve) and a Google
 * OAuth token endpoint (S12 design §7.1 Rev 2 "The fake").
 *
 * It never contacts a real platform. It binds 127.0.0.1 on an ephemeral port.
 *
 * - Audiences: it holds a REMOTE MEMBER SET per list, seeded by the test, and applies remove,
 *   replace sessions and remove-all (with `removeAsOfTime`) to it, so tests assert the resulting
 *   set, not just the request (§6.2 Rev 2).
 * - Conversions: it can RECORD THEN DROP the connection (accepted, response lost), HANG, STALL, or
 *   answer any status. It applies each platform's documented repeat rule: Meta keeps every server
 *   repeat; Google keeps the first `transactionId` (§4.5 Rev 2).
 * - It answers `requestStatus:retrieve` from a scripted sequence.
 *
 * Wire shapes not stated on the platforms' pages (recorded in the package README, "Unverified"):
 * the JSON shape of Meta's `operation_status` (this fake returns `{ code, description }` and the
 * client reads only the description), and the response body of Meta's DELETE /users.
 */
import * as http from "node:http";
import type { HashedMember } from "../types.js";
export type FakeRoute = "meta.events" | "meta.users.add" | "meta.users.delete" | "meta.usersreplace" | "meta.status" | "google.events" | "google.ingest" | "google.remove" | "google.removeAll" | "google.status" | "oauth.token";
/**
 * A one-shot behaviour for the next request on a route.
 * - `status`: answer `status` with `body`, WITHOUT applying the request.
 * - `hang`: never answer (the client's timeout must fire). Not applied.
 * - `drop`: apply and record, then destroy the socket with no response (accepted, response lost).
 * - `stall`: apply, then answer normally after `ms`.
 */
export type FakeBehaviour = {
    kind: "status";
    status: number;
    body?: unknown;
} | {
    kind: "hang";
} | {
    kind: "drop";
} | {
    kind: "stall";
    ms: number;
};
export interface FakeRequest {
    route: FakeRoute | "unrouted";
    method: string;
    path: string;
    query: Record<string, string>;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}
type GoogleStatus = "PROCESSING" | "SUCCESS" | "FAILED" | "PARTIAL_SUCCESS" | "REQUEST_STATUS_UNKNOWN";
export interface FakeAdServerOptions {
    /** PEM public key; when set, the token endpoint verifies the JWT assertion's RS256 signature. */
    serviceAccountPublicKey?: string;
    /** How many `operation_status` reads report `replace_in_progress` after a finished session. Default 1. */
    metaReplaceInProgressReads?: number;
}
export interface FakeAdServer {
    url: string;
    /** Meta Graph base, without the version (the client appends `/<version>`). */
    metaBase: string;
    /** Google Data Manager base, without the version (the client appends `/v1`). */
    googleBase: string;
    tokenUri: string;
    /** Every request, in arrival order. */
    readonly requests: FakeRequest[];
    /** Requests on one route. */
    requestsOn(route: FakeRoute): FakeRequest[];
    /** Queue a one-shot behaviour for the next request on `route` (FIFO per route). */
    next(route: FakeRoute, behaviour: FakeBehaviour): void;
    meta: {
        seed(audienceId: string, members: HashedMember[]): void;
        /** Sorted member identities on the remote list. */
        members(audienceId: string): string[];
        /** Every event the dataset has kept (Meta keeps every server repeat). */
        events(datasetId: string): unknown[];
        /** The replace session times out on the batch after `batches` (error 2650 / 1870158). */
        timeoutReplaceAfterBatch(audienceId: string, batches: number): void;
        /** The next finished replace on this audience ends in `replace_error`. */
        failNextReplace(audienceId: string): void;
    };
    google: {
        seed(userListId: string, members: HashedMember[]): void;
        members(userListId: string): string[];
        /** Kept events per conversion action, by first `transactionId`. */
        events(conversionActionId: string): unknown[];
        /**
         * The NEXT request created on any Data Manager write route gets this status sequence on
         * successive `requestStatus:retrieve` reads (the last value repeats). A sequence ending in
         * FAILED means the request is not applied.
         */
        scriptNextRequest(sequence: GoogleStatus[]): void;
    };
    close(): Promise<void>;
}
/** The fake's identity for a Meta member: the same key the client's rows produce. */
export declare function metaMemberKey(m: HashedMember): string;
/** The fake's identity for a Google member. */
export declare function googleMemberKey(m: HashedMember): string;
export declare function startFakeAdServer(options?: FakeAdServerOptions): Promise<FakeAdServer>;
export {};
//# sourceMappingURL=index.d.ts.map