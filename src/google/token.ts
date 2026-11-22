/**
 * A Google service-account access-token source (OAuth 2.0 JWT bearer grant, RS256), for the
 * Data Manager scope. The caller passes the credentials JSON (Rello reads it from its env); this
 * package never stores it, and no error message carries a key, a token or the JSON.
 */
import { createSign } from "node:crypto";
import { httpRequest, parseJsonSafe } from "../http.js";
import { GOOGLE_DATAMANAGER_SCOPE } from "./client.js";

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
/** Refresh this long before the token's stated expiry. */
const EXPIRY_SKEW_MS = 60_000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function parseCredentials(json: string): ServiceAccount {
  const o = (typeof json === "string" ? parseJsonSafe(json) : undefined) as Partial<ServiceAccount> | undefined;
  if (!o || typeof o !== "object") throw new Error("Google service-account credentials are not valid JSON");
  if (typeof o.client_email !== "string" || o.client_email.trim() === "") throw new Error("Google service-account credentials have no client_email");
  if (typeof o.private_key !== "string" || !o.private_key.includes("PRIVATE KEY")) throw new Error("Google service-account credentials have no private_key");
  const tokenUri = typeof o.token_uri === "string" && o.token_uri.trim() !== "" ? o.token_uri.trim() : DEFAULT_TOKEN_URI;
  return { client_email: o.client_email.trim(), private_key: o.private_key, token_uri: tokenUri };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export function serviceAccountTokenSource(
  credentialsJson: string,
  opts: { scope?: string; timeoutMs?: number; now?: () => Date } = {},
): () => Promise<string> {
  const sa = parseCredentials(credentialsJson);
  const scope = opts.scope ?? GOOGLE_DATAMANAGER_SCOPE;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const now = opts.now ?? (() => new Date());
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  const mint = async (): Promise<string> => {
    const iat = Math.floor(now().getTime() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: sa.token_uri, iat, exp: iat + 3600 }));
    let signature: string;
    try {
      const signer = createSign("RSA-SHA256");
      signer.update(`${header}.${claims}`);
      signer.end();
      signature = signer.sign(sa.private_key).toString("base64url");
    } catch {
      throw new Error("Google token: the service-account private key could not sign");
    }
    const r = await httpRequest({
      url: sa.token_uri,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }).toString(),
      timeoutMs,
    });
    if (r.kind !== "response") throw new Error(`Google token request failed: ${r.reason}`);
    const j = parseJsonSafe(r.text) as { access_token?: unknown; expires_in?: unknown; error?: unknown } | undefined;
    if (r.status < 200 || r.status >= 300 || typeof j?.access_token !== "string" || j.access_token === "") {
      const code = typeof j?.error === "string" ? j.error.replace(/[^a-z_]/gi, "").slice(0, 40) : "no_error_code";
      throw new Error(`Google token request failed: HTTP ${r.status} ${code}`);
    }
    const ttl = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in * 1000 : 3_600_000;
    cached = { token: j.access_token, expiresAt: now().getTime() + ttl - EXPIRY_SKEW_MS };
    return j.access_token;
  };

  return async () => {
    if (cached && now().getTime() < cached.expiresAt) return cached.token;
    // Concurrent callers share one mint.
    inFlight ??= mint().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
