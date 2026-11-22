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
import { createVerify } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { HashedMember } from "../types.js";

export type FakeRoute =
  | "meta.events"
  | "meta.users.add"
  | "meta.users.delete"
  | "meta.usersreplace"
  | "meta.status"
  | "google.events"
  | "google.ingest"
  | "google.remove"
  | "google.removeAll"
  | "google.status"
  | "oauth.token";

/**
 * A one-shot behaviour for the next request on a route.
 * - `status`: answer `status` with `body`, WITHOUT applying the request.
 * - `hang`: never answer (the client's timeout must fire). Not applied.
 * - `drop`: apply and record, then destroy the socket with no response (accepted, response lost).
 * - `stall`: apply, then answer normally after `ms`.
 */
export type FakeBehaviour =
  | { kind: "status"; status: number; body?: unknown }
  | { kind: "hang" }
  | { kind: "drop" }
  | { kind: "stall"; ms: number };

export interface FakeRequest {
  route: FakeRoute | "unrouted";
  method: string;
  path: string;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

type GoogleStatus = "PROCESSING" | "SUCCESS" | "FAILED" | "PARTIAL_SUCCESS" | "REQUEST_STATUS_UNKNOWN";

interface GoogleRequestRecord {
  destination: Record<string, unknown>;
  sequence: GoogleStatus[];
  reads: number;
  errorCounts: Array<{ recordCount: string; reason: string }>;
}

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
export function metaMemberKey(m: HashedMember): string {
  const parts: string[] = [];
  if (m.email) parts.push(`EMAIL:${m.email}`);
  if (m.phone) parts.push(`PHONE:${m.phone}`);
  return parts.join("|");
}

/** The fake's identity for a Google member. */
export function googleMemberKey(m: HashedMember): string {
  const parts: string[] = [];
  if (m.email) parts.push(`emailAddress:${m.email}`);
  if (m.phone) parts.push(`phoneNumber:${m.phone}`);
  return parts.join("|");
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}

function metaRowKeys(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { schema?: unknown; data?: unknown };
  const schema = typeof p.schema === "string" ? [p.schema] : p.schema;
  if (!Array.isArray(schema) || !Array.isArray(p.data)) return null;
  const keys: string[] = [];
  for (const raw of p.data) {
    const row = Array.isArray(raw) ? raw : [raw];
    const key = schema
      .map((field, i) => (typeof row[i] === "string" && row[i] !== "" ? `${String(field)}:${row[i]}` : ""))
      .filter((s) => s !== "")
      .join("|");
    if (key) keys.push(key);
  }
  return keys;
}

function googleMemberKeys(audienceMembers: unknown): string[] | null {
  if (!Array.isArray(audienceMembers)) return null;
  const keys: string[] = [];
  for (const m of audienceMembers) {
    const ids = (m as { userData?: { userIdentifiers?: unknown } })?.userData?.userIdentifiers;
    if (!Array.isArray(ids)) return null;
    const parts: string[] = [];
    for (const id of ids) {
      const o = id as { emailAddress?: unknown; phoneNumber?: unknown };
      if (typeof o.emailAddress === "string") parts.push(`emailAddress:${o.emailAddress}`);
      if (typeof o.phoneNumber === "string") parts.push(`phoneNumber:${o.phoneNumber}`);
    }
    if (parts.length) keys.push(parts.join("|"));
  }
  return keys;
}

function firstDestination(body: unknown): Record<string, unknown> | null {
  const d = (body as { destinations?: unknown })?.destinations;
  if (!Array.isArray(d) || d.length === 0 || typeof d[0] !== "object" || d[0] === null) return null;
  return d[0] as Record<string, unknown>;
}

function googleError(status: number, code: string, message: string): { status: number; body: unknown } {
  return { status, body: { error: { code: status, message, status: code } } };
}

function verifyJwt(assertion: string, publicKey: string): boolean {
  const parts = assertion.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts as [string, string, string];
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${p}`);
  v.end();
  try {
    return v.verify(publicKey, Buffer.from(s, "base64url"));
  } catch {
    return false;
  }
}

export async function startFakeAdServer(options: FakeAdServerOptions = {}): Promise<FakeAdServer> {
  const requests: FakeRequest[] = [];
  const queues = new Map<FakeRoute, FakeBehaviour[]>();
  const openSockets = new Set<import("node:net").Socket>();

  const metaAudiences = new Map<string, Set<string>>();
  const metaEvents = new Map<string, unknown[]>();
  const metaSessions = new Map<string, { id: string; pending: Set<string>; batches: number }>();
  const metaTimeoutAfter = new Map<string, number>();
  const metaFailNext = new Set<string>();
  const metaStatus = new Map<string, { inProgressReads: number; error: boolean }>();
  const inProgressReads = options.metaReplaceInProgressReads ?? 1;

  const googleLists = new Map<string, Map<string, number>>();
  const googleEvents = new Map<string, Map<string, unknown>>();
  const googleRequests = new Map<string, GoogleRequestRecord>();
  let nextScript: GoogleStatus[] | null = null;
  let requestCounter = 0;
  let tokenCounter = 0;

  const metaSet = (id: string): Set<string> => {
    let s = metaAudiences.get(id);
    if (!s) metaAudiences.set(id, (s = new Set()));
    return s;
  };
  const googleList = (id: string): Map<string, number> => {
    let m = googleLists.get(id);
    if (!m) googleLists.set(id, (m = new Map()));
    return m;
  };

  /** Create a Data Manager request record; returns its id and whether it will be applied. */
  const newGoogleRequest = (destination: Record<string, unknown>, errorCounts: GoogleRequestRecord["errorCounts"] = []) => {
    const id = `fake-request-${++requestCounter}`;
    let sequence: GoogleStatus[] = nextScript ?? ["SUCCESS"];
    nextScript = null;
    if (sequence.length === 0) sequence = ["SUCCESS"];
    googleRequests.set(id, { destination, sequence, reads: 0, errorCounts });
    const final = sequence[sequence.length - 1];
    return { id, applied: final === "SUCCESS" || final === "PARTIAL_SUCCESS" };
  };

  const bearerOk = (req: http.IncomingMessage) => /^Bearer \S+/.test(String(req.headers.authorization ?? ""));

  type Answer = { status: number; body: unknown } | null;

  /** Applies the request and returns the normal answer. Returns null for an unknown route. */
  const handle = (route: FakeRoute, req: http.IncomingMessage, segs: string[], query: Record<string, string>, raw: Buffer): Answer => {
    const json = parseJson(raw);
    switch (route) {
      case "meta.events": {
        if (!bearerOk(req)) return { status: 400, body: { error: { code: 190, message: "Invalid OAuth access token" } } };
        const data = (json as { data?: unknown })?.data;
        if (!Array.isArray(data)) return { status: 400, body: { error: { code: 100, message: "Invalid parameter: data" } } };
        const dataset = segs[2] ?? "";
        const kept = metaEvents.get(dataset) ?? [];
        kept.push(...data);
        metaEvents.set(dataset, kept);
        return { status: 200, body: { events_received: data.length, messages: [], fbtrace_id: `fake-trace-${kept.length}` } };
      }
      case "meta.users.add":
      case "meta.users.delete": {
        const aud = segs[2] ?? "";
        const keys = metaRowKeys((json as { payload?: unknown })?.payload);
        if (!keys) return { status: 400, body: { error: { code: 100, message: "Invalid parameter: payload" } } };
        const set = metaSet(aud);
        for (const k of keys) (route === "meta.users.add" ? set.add(k) : set.delete(k));
        return { status: 200, body: { audience_id: aud, session_id: Date.now(), num_received: keys.length, num_invalid_entries: 0 } };
      }
      case "meta.usersreplace": {
        const aud = segs[2] ?? "";
        const b = json as { session?: { session_id?: unknown; batch_seq?: unknown; last_batch_flag?: unknown }; payload?: unknown };
        const sid = String(b?.session?.session_id ?? "");
        const seq = Number(b?.session?.batch_seq);
        const keys = metaRowKeys(b?.payload);
        if (!sid || !Number.isInteger(seq) || seq < 1 || !keys) {
          return { status: 400, body: { error: { code: 2650, error_subcode: 1870147, message: "Invalid Upload Batch for Replace" } } };
        }
        let session = metaSessions.get(aud);
        if (seq === 1) {
          if (session && session.id !== sid) {
            return { status: 400, body: { error: { code: 2650, error_subcode: 1870145, message: "Audience Update In Progress" } } };
          }
          session = { id: sid, pending: new Set(), batches: 0 };
          metaSessions.set(aud, session);
        } else if (!session || session.id !== sid) {
          return { status: 400, body: { error: { code: 2650, error_subcode: 1870159, message: "Replace Session Finished" } } };
        }
        const limit = metaTimeoutAfter.get(aud);
        if (limit !== undefined && session.batches >= limit) {
          // "Your customer list custom audience will be replaced with what you've uploaded so far."
          metaAudiences.set(aud, new Set(session.pending));
          metaSessions.delete(aud);
          metaTimeoutAfter.delete(aud);
          return { status: 400, body: { error: { code: 2650, error_subcode: 1870158, message: "Replace Session Timed Out" } } };
        }
        for (const k of keys) session.pending.add(k);
        session.batches++;
        if (b?.session?.last_batch_flag === true) {
          const failed = metaFailNext.delete(aud);
          if (!failed) metaAudiences.set(aud, new Set(session.pending));
          metaSessions.delete(aud);
          metaStatus.set(aud, { inProgressReads, error: failed });
        }
        return { status: 200, body: { account_id: 1, session_id: Number(sid), num_received: keys.length, num_invalid_entries: 0 } };
      }
      case "meta.status": {
        const aud = segs[2] ?? "";
        const st = metaStatus.get(aud);
        let description = "Normal";
        let code = 200;
        if (st && st.inProgressReads > 0) {
          st.inProgressReads--;
          description = "replace_in_progress";
          code = 300;
        } else if (st?.error) {
          description = "replace_error";
          code = 400;
        }
        return { status: 200, body: { id: aud, operation_status: { code, description } } };
      }
      case "google.ingest":
      case "google.remove":
      case "google.removeAll": {
        if (!bearerOk(req)) return googleError(401, "UNAUTHENTICATED", "Request is missing required authentication credential.");
        const dest = firstDestination(json);
        const listId = typeof dest?.productDestinationId === "string" ? dest.productDestinationId : null;
        if (!dest || !listId) return googleError(400, "INVALID_ARGUMENT", "destinations is required");
        let keys: string[] | null = [];
        if (route !== "google.removeAll") {
          keys = googleMemberKeys((json as { audienceMembers?: unknown })?.audienceMembers);
          if (!keys || keys.length === 0) return googleError(400, "INVALID_ARGUMENT", "audienceMembers is required");
        }
        const { id, applied } = newGoogleRequest(dest);
        if (applied) {
          const list = googleList(listId);
          if (route === "google.ingest") {
            // Re-ingesting a held member refreshes its added-time, so a remove-all as of T keeps it.
            // That is the premise of the design's replace (§6.2 Rev 2); README "Unverified".
            const now = Date.now();
            for (const k of keys) list.set(k, now);
          } else if (route === "google.remove") {
            for (const k of keys) list.delete(k);
          } else {
            const asOf = (json as { removeAsOfTime?: unknown })?.removeAsOfTime;
            const cutoff = typeof asOf === "string" ? Date.parse(asOf) : Number.POSITIVE_INFINITY;
            for (const [k, addedAt] of [...list]) if (addedAt < cutoff) list.delete(k);
          }
        }
        return { status: 200, body: { requestId: id } };
      }
      case "google.events": {
        if (!bearerOk(req)) return googleError(401, "UNAUTHENTICATED", "Request is missing required authentication credential.");
        const dest = firstDestination(json);
        const action = typeof dest?.productDestinationId === "string" ? dest.productDestinationId : null;
        const events = (json as { events?: unknown })?.events;
        if (!dest || !action || !Array.isArray(events)) return googleError(400, "INVALID_ARGUMENT", "destinations and events are required");
        let kept = googleEvents.get(action);
        if (!kept) googleEvents.set(action, (kept = new Map()));
        let duplicates = 0;
        for (const e of events) {
          const tx = String((e as { transactionId?: unknown })?.transactionId ?? "");
          if (tx && kept.has(tx)) duplicates++;
          else kept.set(tx || `untagged-${kept.size}`, e);
        }
        const errorCounts = duplicates ? [{ recordCount: String(duplicates), reason: "PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID" }] : [];
        if (duplicates && !nextScript) nextScript = [duplicates === events.length ? "FAILED" : "PARTIAL_SUCCESS"];
        const { id } = newGoogleRequest(dest, errorCounts);
        return { status: 200, body: { requestId: id } };
      }
      case "google.status": {
        const rec = googleRequests.get(query.requestId ?? "");
        if (!rec) return googleError(404, "NOT_FOUND", "request not found");
        const i = Math.min(rec.reads, rec.sequence.length - 1);
        rec.reads++;
        const requestStatus = rec.sequence[i];
        return {
          status: 200,
          body: {
            requestStatusPerDestination: [
              {
                destination: rec.destination,
                requestStatus,
                ...(rec.errorCounts.length && requestStatus !== "PROCESSING" ? { errorInfo: { errorCounts: rec.errorCounts } } : {}),
              },
            ],
          },
        };
      }
      case "oauth.token": {
        const form = new URLSearchParams(raw.toString("utf8"));
        const assertion = form.get("assertion") ?? "";
        if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || !assertion) {
          return { status: 400, body: { error: "invalid_request" } };
        }
        if (options.serviceAccountPublicKey && !verifyJwt(assertion, options.serviceAccountPublicKey)) {
          return { status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT Signature." } };
        }
        return { status: 200, body: { access_token: `fake-access-${++tokenCounter}`, expires_in: 3600, token_type: "Bearer" } };
      }
    }
  };

  const routeOf = (method: string, segs: string[], query: Record<string, string>): FakeRoute | null => {
    // segs[0] = "meta" | "google" | "oauth2"
    if (segs[0] === "meta" && segs.length >= 3) {
      const tail = segs[3];
      if (method === "POST" && tail === "events" && segs.length === 4) return "meta.events";
      if (tail === "users" && segs.length === 4) return method === "DELETE" ? "meta.users.delete" : method === "POST" ? "meta.users.add" : null;
      if (method === "POST" && tail === "usersreplace" && segs.length === 4) return "meta.usersreplace";
      if (method === "GET" && segs.length === 3 && (query.fields ?? "").includes("operation_status")) return "meta.status";
    }
    if (segs[0] === "google" && segs[1] === "v1" && segs.length === 3) {
      const op = segs[2];
      if (method === "POST" && op === "audienceMembers:ingest") return "google.ingest";
      if (method === "POST" && op === "audienceMembers:remove") return "google.remove";
      if (method === "POST" && op === "audienceMembers:removeAll") return "google.removeAll";
      if (method === "POST" && op === "events:ingest") return "google.events";
      if (method === "GET" && op === "requestStatus:retrieve") return "google.status";
    }
    if (segs[0] === "oauth2" && segs[1] === "token" && method === "POST") return "oauth.token";
    return null;
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const raw = await readBody(req);
        const u = new URL(req.url ?? "/", "http://fake.local");
        const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        const query = Object.fromEntries(u.searchParams.entries());
        const method = (req.method ?? "GET").toUpperCase();
        const route = routeOf(method, segs, query);
        requests.push({ route: route ?? "unrouted", method, path: u.pathname, query, headers: req.headers, body: raw });
        if (!route) {
          res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "fake: no such route" }));
          return;
        }
        const behaviour = queues.get(route)?.shift();
        if (behaviour?.kind === "hang") return; // never answer; the socket is closed on server close
        if (behaviour?.kind === "status") {
          res.writeHead(behaviour.status, { "content-type": "application/json" }).end(behaviour.body === undefined ? "" : JSON.stringify(behaviour.body));
          return;
        }
        const answer = handle(route, req, segs, query, raw);
        if (behaviour?.kind === "drop") {
          req.socket.destroy();
          return;
        }
        const send = () => {
          const a = answer ?? { status: 500, body: { error: "fake: unhandled" } };
          res.writeHead(a.status, { "content-type": "application/json" }).end(JSON.stringify(a.body));
        };
        if (behaviour?.kind === "stall") setTimeout(send, behaviour.ms);
        else send();
      } catch (err) {
        console.error("[ad-platforms/fake] handler error", err);
        if (!res.headersSent) res.writeHead(500).end();
      }
    })();
  });
  server.on("connection", (s) => {
    openSockets.add(s);
    s.on("close", () => openSockets.delete(s));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    metaBase: `${url}/meta`,
    googleBase: `${url}/google`,
    tokenUri: `${url}/oauth2/token`,
    requests,
    requestsOn: (route) => requests.filter((r) => r.route === route),
    next: (route, behaviour) => {
      const q = queues.get(route) ?? [];
      q.push(behaviour);
      queues.set(route, q);
    },
    meta: {
      seed: (id, members) => {
        const s = metaSet(id);
        for (const m of members) s.add(metaMemberKey(m));
      },
      members: (id) => [...(metaAudiences.get(id) ?? [])].sort(),
      events: (id) => [...(metaEvents.get(id) ?? [])],
      timeoutReplaceAfterBatch: (id, n) => void metaTimeoutAfter.set(id, n),
      failNextReplace: (id) => void metaFailNext.add(id),
    },
    google: {
      seed: (id, members) => {
        const list = googleList(id);
        for (const m of members) list.set(googleMemberKey(m), 0); // seeded long ago: before any removeAsOfTime
      },
      members: (id) => [...(googleLists.get(id)?.keys() ?? [])].sort(),
      events: (id) => [...(googleEvents.get(id)?.values() ?? [])],
      scriptNextRequest: (sequence) => void (nextScript = [...sequence]),
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const s of openSockets) s.destroy();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
