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
export declare function httpRequest(req: HttpRequest): Promise<HttpResult>;
/** JSON.parse that answers undefined for anything unparseable. */
export declare function parseJsonSafe(text: string): unknown;
//# sourceMappingURL=http.d.ts.map