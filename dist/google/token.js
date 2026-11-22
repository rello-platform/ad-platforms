/**
 * A Google service-account access-token source (OAuth 2.0 JWT bearer grant, RS256), for the
 * Data Manager scope. The caller passes the credentials JSON (Rello reads it from its env); this
 * package never stores it, and no error message carries a key, a token or the JSON.
 */
import { createSign } from "node:crypto";
import { httpRequest, parseJsonSafe } from "../http.js";
import { GOOGLE_DATAMANAGER_SCOPE } from "./client.js";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
/**
 * GD-2960 step 2: the token endpoint's `error` value reaches a thrown message only when it is one of the
 * RFC 6749 §5.2 codes, https://www.rfc-editor.org/rfc/rfc6749.txt §5.2 "Error Response", read 2026-11-22
 * (prompt 1687): six codes. Anything else (an extension code, or any other text) is "unrecognized_error".
 */
const OAUTH_TOKEN_ERRORS = new Set(["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope"]);
/** Refresh this long before the token's stated expiry. */
const EXPIRY_SKEW_MS = 60_000;
/**
 * Why a credentials JSON is unusable, as a fixed code (GD-2954): a caller logs `code`, never a message.
 */
export class GoogleCredentialsError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "GoogleCredentialsError";
    }
}
function parseCredentials(json) {
    const o = (typeof json === "string" ? parseJsonSafe(json) : undefined);
    if (!o || typeof o !== "object")
        throw new GoogleCredentialsError("google_credentials_not_json", "Google service-account credentials are not valid JSON");
    if (typeof o.client_email !== "string" || o.client_email.trim() === "")
        throw new GoogleCredentialsError("google_credentials_no_client_email", "Google service-account credentials have no client_email");
    if (typeof o.private_key !== "string" || !o.private_key.includes("PRIVATE KEY"))
        throw new GoogleCredentialsError("google_credentials_no_private_key", "Google service-account credentials have no private_key");
    const tokenUri = typeof o.token_uri === "string" && o.token_uri.trim() !== "" ? o.token_uri.trim() : DEFAULT_TOKEN_URI;
    return { client_email: o.client_email.trim(), private_key: o.private_key, token_uri: tokenUri };
}
const b64url = (v) => Buffer.from(v).toString("base64url");
export function serviceAccountTokenSource(credentialsJson, opts = {}) {
    const sa = parseCredentials(credentialsJson);
    const scope = opts.scope ?? GOOGLE_DATAMANAGER_SCOPE;
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const now = opts.now ?? (() => new Date());
    let cached = null;
    let inFlight = null;
    const mint = async () => {
        const iat = Math.floor(now().getTime() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
        const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: sa.token_uri, iat, exp: iat + 3600 }));
        let signature;
        try {
            const signer = createSign("RSA-SHA256");
            signer.update(`${header}.${claims}`);
            signer.end();
            signature = signer.sign(sa.private_key).toString("base64url");
        }
        catch {
            throw new Error("Google token: the service-account private key could not sign");
        }
        const r = await httpRequest({
            url: sa.token_uri,
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }).toString(),
            timeoutMs,
        });
        if (r.kind !== "response")
            throw new Error(`Google token request failed: ${r.reason}`);
        const j = parseJsonSafe(r.text);
        if (r.status < 200 || r.status >= 300 || typeof j?.access_token !== "string" || j.access_token === "") {
            const code = typeof j?.error === "string" ? (OAUTH_TOKEN_ERRORS.has(j.error) ? j.error : "unrecognized_error") : "no_error_code";
            throw new Error(`Google token request failed: HTTP ${r.status} ${code}`);
        }
        const ttl = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in * 1000 : 3_600_000;
        cached = { token: j.access_token, expiresAt: now().getTime() + ttl - EXPIRY_SKEW_MS };
        return j.access_token;
    };
    return async () => {
        if (cached && now().getTime() < cached.expiresAt)
            return cached.token;
        // Concurrent callers share one mint.
        inFlight ??= mint().finally(() => {
            inFlight = null;
        });
        return inFlight;
    };
}
