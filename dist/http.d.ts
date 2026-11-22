export type HttpResult = {
    kind: "response";
    status: number;
    text: string;
} | {
    kind: "transport_error";
    written: boolean;
    reason: string;
};
export interface HttpRequest {
    url: string;
    method: "GET" | "POST" | "DELETE";
    headers?: Record<string, string>;
    body?: Uint8Array | string;
    timeoutMs: number;
}
/**
 * GD-2954: a transport reason carries Node's error CODE (ECONNREFUSED, ECONNRESET,
 * ERR_TLS_CERT_ALTNAME_INVALID, ...), never the error's message, which can carry hosts, ports or a
 * peer certificate's names. A reason ends up in outcomes and in the caller's records.
 */
export declare function transportErrorCode(err: unknown): string;
export declare function httpRequest(req: HttpRequest): Promise<HttpResult>;
/** JSON.parse that answers undefined for anything unparseable. */
export declare function parseJsonSafe(text: string): unknown;
//# sourceMappingURL=http.d.ts.map