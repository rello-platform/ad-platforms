/**
 * Google Data Manager API: conversions (`events:ingest`, frozen batches) and Customer Match audiences
 * (`audienceMembers:ingest` / `:remove` / `:removeAll`), plus `requestStatus:retrieve`
 * (S12 design §6.2 Rev 2, §4.5 Rev 4 item 2, §7.1 Rev 4).
 *
 * Paths, fields and the OAuth scope are from the Data Manager REST reference (read 2026-11-22):
 *   POST /v1/audienceMembers:ingest | :remove | :removeAll, POST /v1/events:ingest,
 *   GET /v1/requestStatus:retrieve?requestId=…, scope https://www.googleapis.com/auth/datamanager.
 *
 * New Customer Match integrations must use Data Manager since 2026-04-01, so this is a NEW client;
 * the Drumbeat's Google Ads API (v26) client moves in separately, unchanged, for the Drumbeat only.
 */
import { frozenBodyMatches } from "../jcs.js";
import { normalizeEmail, normalizePhone, sha256Hex } from "../normalize.js";
import { httpRequest, parseJsonSafe } from "../http.js";
import { realSleep, } from "../types.js";
export const GOOGLE_DATAMANAGER_DEFAULT_API_BASE = "https://datamanager.googleapis.com";
export const GOOGLE_DATAMANAGER_API_VERSION = "v1";
export const GOOGLE_DATAMANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";
/** "At most 10000 … resources can be sent in a single request." */
export const GOOGLE_AUDIENCE_MEMBERS_PER_REQUEST_LIMIT = 10_000;
/** "At most 2000 … resources can be sent in a single request." */
export const GOOGLE_EVENTS_PER_REQUEST_LIMIT = 2_000;
const trimSlash = (s) => s.replace(/\/+$/, "");
const accountDigits = (id) => id.replace(/-/g, "").trim();
const GRANTED = { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" };
function destination(config, productDestinationId) {
    const op = accountDigits(config.operatingAccountId ?? "");
    if (!/^\d+$/.test(op))
        throw new Error("Data Manager: operatingAccountId must be a Google Ads customer id");
    const login = config.loginAccountId ? accountDigits(config.loginAccountId) : "";
    if (login && !/^\d+$/.test(login))
        throw new Error("Data Manager: loginAccountId must be a Google Ads customer id");
    return {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: op },
        ...(login ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: login } } : {}),
        productDestinationId,
    };
}
function identifiers(m) {
    const ids = [];
    if (m.email)
        ids.push({ emailAddress: m.email });
    if (m.phone)
        ids.push({ phoneNumber: m.phone });
    return ids;
}
/** Builds the `events:ingest` request object for `freezeBatch`. Hashing happens here, once. */
export function buildGoogleConversionRequest(config, input) {
    if (typeof input.conversionActionId !== "string" || input.conversionActionId.trim() === "") {
        throw new Error("buildGoogleConversionRequest: conversionActionId is required");
    }
    if (!Array.isArray(input.events) || input.events.length === 0)
        throw new Error("buildGoogleConversionRequest: at least one event is required");
    if (input.events.length > GOOGLE_EVENTS_PER_REQUEST_LIMIT)
        throw new Error(`buildGoogleConversionRequest: at most ${GOOGLE_EVENTS_PER_REQUEST_LIMIT} events per request`);
    const events = input.events.map((e, i) => {
        if (!e.transactionId)
            throw new Error(`buildGoogleConversionRequest: event ${i} needs a transactionId`);
        const t = e.eventTime instanceof Date ? e.eventTime.getTime() : Number.NaN;
        if (!Number.isFinite(t))
            throw new Error(`buildGoogleConversionRequest: event ${i} has an invalid eventTime`);
        const em = e.email ? normalizeEmail("GOOGLE", e.email) : null;
        const ph = e.phone ? normalizePhone("GOOGLE", e.phone) : null;
        const ids = identifiers({ ...(em ? { email: sha256Hex(em) } : {}), ...(ph ? { phone: sha256Hex(ph) } : {}) });
        const ad = {};
        if (e.gclid)
            ad.gclid = e.gclid;
        if (e.gbraid)
            ad.gbraid = e.gbraid;
        if (e.wbraid)
            ad.wbraid = e.wbraid;
        // "You must set at least one of": adIdentifiers, session attributes, userData, or the IP.
        if (ids.length === 0 && Object.keys(ad).length === 0) {
            throw new Error(`buildGoogleConversionRequest: event ${i} has no identifier Google can match`);
        }
        const ev = {
            transactionId: e.transactionId,
            eventTimestamp: new Date(t).toISOString(),
            eventSource: "WEB",
            ...(ids.length ? { userData: { userIdentifiers: ids } } : {}),
            ...(Object.keys(ad).length ? { adIdentifiers: ad } : {}),
        };
        if (e.value) {
            if (!Number.isFinite(e.value.amount) || e.value.amount < 0)
                throw new Error(`buildGoogleConversionRequest: event ${i} has an invalid value`);
            if (!/^[A-Z]{3}$/.test(e.value.currency))
                throw new Error(`buildGoogleConversionRequest: event ${i} needs an ISO 4217 currency`);
            ev.conversionValue = e.value.amount;
            ev.currency = e.value.currency;
        }
        return ev;
    });
    return {
        endpoint: `${trimSlash(config.apiBase ?? GOOGLE_DATAMANAGER_DEFAULT_API_BASE)}/${GOOGLE_DATAMANAGER_API_VERSION}/events:ingest`,
        apiVersion: GOOGLE_DATAMANAGER_API_VERSION,
        request: { destinations: [destination(config, input.conversionActionId)], encoding: "HEX", consent: GRANTED, events },
    };
}
/** The next 00:00 America/Los_Angeles after `now`, as an ISO instant (the daily quota reset). */
export function nextMidnightPacific(now) {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    const parts = (t) => Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const p = parts(now.getTime());
    const y = Number(p.year);
    const m = Number(p.month);
    const d = Number(p.day);
    // Midnight is never inside a DST transition (those happen at 02:00), so the offset is −7 or −8.
    for (const offset of [7, 8]) {
        const t = Date.UTC(y, m - 1, d + 1, offset);
        const q = parts(t);
        const next = new Date(Date.UTC(y, m - 1, d + 1));
        if (q.hour === "00" && Number(q.day) === next.getUTCDate() && Number(q.month) === next.getUTCMonth() + 1)
            return new Date(t).toISOString();
    }
    throw new Error("nextMidnightPacific: could not resolve the Pacific offset");
}
const RETRY = new Set(["UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL", "UNKNOWN", "ABORTED"]);
const FINAL = new Set(["INVALID_ARGUMENT", "PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND", "FAILED_PRECONDITION"]);
/**
 * GD-2954: the gRPC canonical status codes. An error body's `status` reaches a reason only when it is
 * one of these; anything else is platform text and the reason falls back to `google_http_<status>`.
 */
const CANONICAL = new Set([
    "OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED",
    "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED",
]);
/**
 * GD-2954: a request-status error reason reaches a returned field or a reason only when it has the
 * shape of a Data Manager ProcessingErrorReason enum name; any other text becomes UNRECOGNIZED_REASON.
 */
function safeGoogleErrorReason(reason) {
    return /^PROCESSING_ERROR_REASON_[A-Z0-9_]{1,80}$/.test(reason) ? reason : "UNRECOGNIZED_REASON";
}
/** The Google classes of §4.5 Rev 4 item 2. Exported for tests. */
export function classifyGoogleResponse(r, now) {
    if (r.kind === "transport_error") {
        return r.written ? { status: "unknown", reason: `google_${r.reason}` } : { status: "retryable", reason: `google_${r.reason}` };
    }
    const j = parseJsonSafe(r.text);
    if (r.status >= 200 && r.status < 300) {
        return j && typeof j.requestId === "string" && j.requestId ? { status: "accepted", requestId: j.requestId } : { status: "unknown", reason: "google_2xx_unparseable" };
    }
    const bodyStatus = typeof j?.error?.status === "string" && CANONICAL.has(j.error.status) ? j.error.status : "";
    const status = bodyStatus || (r.status === 429 ? "RESOURCE_EXHAUSTED" : "");
    if (RETRY.has(status))
        return { status: "retryable", reason: `google_${status}` };
    if (status === "RESOURCE_EXHAUSTED") {
        const info = (j?.error?.details ?? []).find((x) => String(x?.["@type"] ?? "").endsWith("google.rpc.ErrorInfo"));
        const limit = info?.metadata?.quota_limit;
        if (limit === "IngestionMutateRequestsPerMinutePerProject")
            return { status: "retryable", reason: "quota_per_minute" };
        const notBefore = nextMidnightPacific(now);
        if (limit === "IngestionMutateRequestsPerDayPerProject")
            return { status: "retryable", reason: "quota_daily", notBefore };
        return { status: "retryable", reason: "quota_unclassified", notBefore };
    }
    if (FINAL.has(status))
        return { status: "rejected", reason: `google_${status}` };
    return { status: "unknown", reason: status ? `google_${status}` : `google_http_${r.status}` };
}
/** Maps a conversion batch's request status to an outcome (a repeated transactionId is `duplicate`, §4.5 Rev 2). */
export function conversionOutcomeFromStatus(d) {
    const reasons = (Array.isArray(d.errorReasons) ? d.errorReasons : []).map((r) => safeGoogleErrorReason(String(r)));
    const onlyDuplicates = reasons.length > 0 && reasons.every((r) => r === "PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID");
    switch (d.status) {
        case "SUCCESS":
            return { status: "accepted" };
        case "FAILED":
            return onlyDuplicates ? { status: "duplicate" } : { status: "rejected", reason: `google_request_failed:${reasons.join(",") || "no_reason"}` };
        case "PARTIAL_SUCCESS":
            // Some events failed. Resending the same body is safe under transactionId dedup, so it is unknown, not final.
            return onlyDuplicates ? { status: "duplicate" } : { status: "unknown", reason: `google_partial_success:${reasons.join(",") || "no_reason"}` };
        case "PROCESSING":
            return { status: "unknown", reason: "google_request_processing" };
        default:
            return { status: "unknown", reason: "google_request_status_unreadable" };
    }
}
const BUILTIN_ERRORS = [Error, TypeError, RangeError, SyntaxError, ReferenceError, URIError, EvalError, AggregateError];
/**
 * The kind of a thrown value, from a fixed vocabulary: a built-in error constructor's name (matched by
 * prototype, so a subclass that borrows a built-in name is not one), "Error subclass", or a typeof.
 * A subclass's own name is never used: it is caller code and could be anything.
 */
function thrownKind(err) {
    if (err instanceof Error) {
        const proto = Object.getPrototypeOf(err);
        return BUILTIN_ERRORS.find((C) => C.prototype === proto)?.name ?? "Error subclass";
    }
    return err === null ? "null" : typeof err;
}
function chunk(xs, n) {
    const out = [];
    for (let i = 0; i < xs.length; i += n)
        out.push(xs.slice(i, i + n));
    return out;
}
export function createGoogleClient(config, options = {}) {
    const base = `${trimSlash(config.apiBase ?? GOOGLE_DATAMANAGER_DEFAULT_API_BASE)}/${GOOGLE_DATAMANAGER_API_VERSION}`;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const batchSize = Math.min(Math.max(1, Math.floor(options.batchSize ?? GOOGLE_AUDIENCE_MEMBERS_PER_REQUEST_LIMIT)), GOOGLE_AUDIENCE_MEMBERS_PER_REQUEST_LIMIT);
    const statusPollMs = options.statusPollMs ?? 30 * 60_000;
    const statusMaxReads = Math.max(1, options.statusMaxReads ?? 12);
    const sleep = options.sleep ?? realSleep;
    const now = options.now ?? (() => new Date());
    const listId = (list) => {
        const id = config.userListIds?.[list];
        return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
    };
    const badAdvertiser = (a) => !a || typeof a.tenantId !== "string" || a.tenantId.trim() === "" ? { status: "rejected", reason: "advertiser_tenant_required" } : null;
    /** A fresh token, or a retryable outcome: nothing was sent to Data Manager. */
    const token = async () => {
        try {
            const t = await config.getAccessToken();
            if (typeof t !== "string" || t.trim() === "")
                return { status: "retryable", reason: "google_token_empty" };
            return t;
        }
        catch (err) {
            // GD-2954: the caller's token source may put anything in what it throws (a key, a token, a
            // response body). Log a fixed code and the thrown value's kind only; never its text.
            console.warn(`[ad-platforms/google] access token unavailable (google_token_unavailable) thrown=${thrownKind(err)}`);
            return { status: "retryable", reason: "google_token_unavailable" };
        }
    };
    const post = async (op, body, tok) => classifyGoogleResponse(await httpRequest({ url: `${base}/${op}`, method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(body), timeoutMs }), now());
    const statusDetail = async (requestId, tok) => {
        const r = await httpRequest({ url: `${base}/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`, method: "GET", headers: { authorization: `Bearer ${tok}` }, timeoutMs });
        if (r.kind !== "response" || r.status < 200 || r.status >= 300)
            return { status: "UNREADABLE", errorReasons: [] };
        const per = parseJsonSafe(r.text)?.requestStatusPerDestination;
        if (!Array.isArray(per) || per.length === 0)
            return { status: "UNREADABLE", errorReasons: [] };
        const statuses = per.map((p) => String(p?.requestStatus ?? ""));
        const errorReasons = per.flatMap((p) => {
            const counts = p?.errorInfo?.errorCounts;
            return Array.isArray(counts) ? counts.map((c) => String(c?.reason ?? "")).filter(Boolean).map(safeGoogleErrorReason) : [];
        });
        let status;
        if (statuses.includes("FAILED"))
            status = "FAILED";
        else if (statuses.includes("PARTIAL_SUCCESS"))
            status = "PARTIAL_SUCCESS";
        else if (statuses.some((s) => s === "PROCESSING" || s === "REQUEST_STATUS_UNKNOWN"))
            status = "PROCESSING";
        else if (statuses.every((s) => s === "SUCCESS"))
            status = "SUCCESS";
        else
            status = "UNREADABLE";
        return { status, errorReasons };
    };
    /** Reads a request's status until it is terminal, or the reads run out (PROCESSING). */
    const settle = async (requestId, tok) => {
        let last = "PROCESSING";
        for (let i = 0; i < statusMaxReads; i++) {
            await sleep(statusPollMs);
            last = (await statusDetail(requestId, tok)).status;
            if (last === "SUCCESS" || last === "FAILED" || last === "PARTIAL_SUCCESS")
                return last;
        }
        return last;
    };
    /** Sends member batches on one write route and settles each request. */
    const writeMembers = async (op, list, members, tok) => {
        const usable = members.filter((m) => m && (m.email || m.phone));
        if (usable.length === 0)
            return { status: "accepted" };
        const batches = chunk(usable, batchSize);
        let done = 0;
        for (let i = 0; i < batches.length; i++) {
            const body = {
                destinations: [destination(config, list)],
                audienceMembers: batches[i].map((m) => ({ userData: { userIdentifiers: identifiers(m) } })),
                encoding: "HEX",
            };
            if (op === "audienceMembers:ingest") {
                body.consent = GRANTED;
                body.termsOfService = { customerMatchTermsOfServiceStatus: "ACCEPTED" };
            }
            const sent = await post(op, body, tok);
            if (sent.status !== "accepted" || !sent.requestId) {
                return i === 0 ? sent : { status: "partial", done, failed: batches.length - done, reason: "reason" in sent ? sent.reason : "google_write_failed" };
            }
            const st = await settle(sent.requestId, tok);
            if (st === "SUCCESS") {
                done++;
                continue;
            }
            if (st === "FAILED" || st === "PARTIAL_SUCCESS")
                return { status: "partial", done, failed: batches.length - done, reason: `google_${op}_${st}` };
            return { status: "unknown", reason: `google_${op}_${st}` };
        }
        return { status: "accepted" };
    };
    const removeAll = async (list, tok, removeAsOfTime) => {
        const sent = await post("audienceMembers:removeAll", { destinations: [destination(config, list)], ...(removeAsOfTime ? { removeAsOfTime } : {}) }, tok);
        if (sent.status !== "accepted" || !sent.requestId)
            return sent;
        const st = await settle(sent.requestId, tok);
        if (st === "SUCCESS")
            return { status: "accepted", requestId: sent.requestId };
        if (st === "FAILED" || st === "PARTIAL_SUCCESS")
            return { status: "partial", done: 0, failed: 1, reason: `google_remove_all_${st}` };
        return { status: "unknown", reason: `google_remove_all_${st}` };
    };
    return {
        platform: "GOOGLE",
        async sendConversionBatch(advertiser, batch) {
            const bad = badAdvertiser(advertiser);
            if (bad)
                return bad;
            if (!frozenBodyMatches(batch))
                return { status: "rejected", reason: "frozen_body_sha256_mismatch" };
            const tok = await token();
            if (typeof tok !== "string")
                return tok;
            const r = await httpRequest({
                url: batch.endpoint,
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
                body: batch.body,
                timeoutMs,
            });
            return classifyGoogleResponse(r, now());
        },
        async replaceAudience(advertiser, list, members, _possiblyApplied) {
            const id = listId(list);
            if (!id)
                return { status: "not_connected" };
            const bad = badAdvertiser(advertiser);
            if (bad)
                return bad;
            const tok = await token();
            if (typeof tok !== "string")
                return tok;
            const usable = members.filter((m) => m && (m.email || m.phone));
            // Target empty: remove-all with no removeAsOfTime clears the whole remote list.
            if (usable.length === 0)
                return removeAll(id, tok);
            // Replace without an empty list: record T, ingest, wait for SUCCESS, then remove-all as of T.
            const t = now().toISOString();
            const ingested = await writeMembers("audienceMembers:ingest", id, usable, tok);
            if (ingested.status !== "accepted")
                return ingested; // a failed ingest never empties the list
            return removeAll(id, tok, t);
        },
        async removeFromAudience(advertiser, list, members) {
            const id = listId(list);
            if (!id)
                return { status: "not_connected" };
            const bad = badAdvertiser(advertiser);
            if (bad)
                return bad;
            const tok = await token();
            if (typeof tok !== "string")
                return tok;
            return writeMembers("audienceMembers:remove", id, members, tok);
        },
        async requestStatus(advertiser, requestId) {
            return (await this.requestStatusDetail(advertiser, requestId)).status;
        },
        async requestStatusDetail(advertiser, requestId) {
            if (badAdvertiser(advertiser) || typeof requestId !== "string" || requestId.trim() === "")
                return { status: "UNREADABLE", errorReasons: [] };
            const tok = await token();
            if (typeof tok !== "string")
                return { status: "UNREADABLE", errorReasons: [] };
            return statusDetail(requestId, tok);
        },
    };
}
