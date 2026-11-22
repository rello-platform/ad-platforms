/**
 * One HTTP request, reporting whether the request could have reached the server.
 *
 * The retry classes (S12 design §4.5 Rev 3 item 3) depend on one fact fetch() does not expose:
 * did the failure happen BEFORE the request was written (DNS, TCP connect, TLS handshake), or
 * after? Only the first is "provably not processed". This uses node:http(s) with a fresh socket per
 * request (agent: false) and marks the request as possibly written from the moment the socket is
 * connected (and, for https, the TLS handshake is done). A failure or timeout after that point is
 * reported `written: true`, which callers treat as an unknown outcome.
 */
import * as http from "node:http";
import * as https from "node:https";

export type HttpResult =
  | { kind: "response"; status: number; text: string }
  | { kind: "transport_error"; written: boolean; reason: string };

export interface HttpRequest {
  url: string;
  method: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  timeoutMs: number;
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * GD-2954: a transport reason carries Node's error CODE (ECONNREFUSED, ECONNRESET,
 * ERR_TLS_CERT_ALTNAME_INVALID, ...), never the error's message, which can carry hosts, ports or a
 * peer certificate's names. A reason ends up in outcomes and in the caller's records.
 */
export function transportErrorCode(err: unknown): string {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "ERROR";
}

export function httpRequest(req: HttpRequest): Promise<HttpResult> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      resolve({ kind: "transport_error", written: false, reason: "invalid_url" });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      resolve({ kind: "transport_error", written: false, reason: "unsupported_protocol" });
      return;
    }
    if (!Number.isFinite(req.timeoutMs) || req.timeoutMs <= 0) {
      resolve({ kind: "transport_error", written: false, reason: "invalid_timeout" });
      return;
    }
    const body = req.body === undefined ? undefined : typeof req.body === "string" ? Buffer.from(req.body, "utf8") : Buffer.from(req.body);
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (body) headers["content-length"] = String(body.length);

    let connected = false;
    let settled = false;
    let tooLarge = false;
    const code = (err: unknown) => (tooLarge ? "RESPONSE_TOO_LARGE" : transportErrorCode(err));
    const done = (r: HttpResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const mod = url.protocol === "https:" ? https : http;
    const cr = mod.request(url, { method: req.method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          tooLarge = true;
          cr.destroy(new Error("response_too_large"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => done({ kind: "response", status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", (err) => done({ kind: "transport_error", written: true, reason: `response_error:${code(err)}` }));
    });

    cr.on("socket", (socket) => {
      const ready = url.protocol === "https:" ? "secureConnect" : "connect";
      if (!socket.connecting && url.protocol === "http:") connected = true;
      socket.once(ready, () => {
        connected = true;
      });
    });
    cr.on("error", (err) => {
      done({ kind: "transport_error", written: connected, reason: connected ? `after_connect:${code(err)}` : `before_write:${code(err)}` });
    });

    const timer = setTimeout(() => {
      const wasConnected = connected;
      done({ kind: "transport_error", written: wasConnected, reason: wasConnected ? "timeout_after_connect" : "timeout_before_connect" });
      cr.destroy();
    }, req.timeoutMs);

    if (body) cr.end(body);
    else cr.end();
  });
}

/** JSON.parse that answers undefined for anything unparseable. */
export function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
