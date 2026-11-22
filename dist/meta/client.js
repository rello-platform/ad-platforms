/**
 * Meta: the Conversions API conversion client (frozen batches) and the custom-audience
 * remove / replace / clear client (S12 design §6.2 Rev 2–3, §4.5 Rev 3 item 3, §7.1 Rev 4).
 *
 * The access token goes in an `Authorization: Bearer` header, never in a body, so a frozen body
 * carries no credential and a rotated token changes nothing Meta deduplicates on. (Meta's pages show
 * the `access_token` parameter; the Graph API also accepts the OAuth bearer header. S13 confirms it
 * against the live account; see README "Unverified".)
 */
import { randomInt } from "node:crypto";
import { frozenBodyMatches } from "../jcs.js";
import { hashExternalId, normalizeEmail, normalizePhone, sha256Hex } from "../normalize.js";
import { httpRequest, parseJsonSafe } from "../http.js";
import { realSleep } from "../types.js";
export const META_DEFAULT_API_BASE = "https://graph.facebook.com";
/** v21.0: the version the Drumbeat's Meta surfaces already use (live until 2027-01-21 per its note). */
export const META_DEFAULT_API_VERSION = "v21.0";
/** "You can add up to 10,000 people to an audience at a given time." */
export const META_MEMBER_BATCH_LIMIT = 10_000;
/** Meta allows at most 1,000 events per Conversions API request. */
export const META_EVENTS_PER_REQUEST_LIMIT = 1_000;
const trimSlash = (s) => s.replace(/\/+$/, "");
/**
 * Builds the Conversions API request object for `freezeBatch`. Hashing happens here, once; the
 * frozen bytes are then never rebuilt. Events keep the caller's order (the ledger orders them by
 * conversionKey, §4.5 Rev 3 item 2).
 */
export function buildMetaConversionRequest(config, events) {
    if (typeof config.datasetId !== "string" || config.datasetId.trim() === "")
        throw new Error("buildMetaConversionRequest: datasetId is required");
    if (!Array.isArray(events) || events.length === 0)
        throw new Error("buildMetaConversionRequest: at least one event is required");
    if (events.length > META_EVENTS_PER_REQUEST_LIMIT)
        throw new Error(`buildMetaConversionRequest: at most ${META_EVENTS_PER_REQUEST_LIMIT} events per request`);
    const apiVersion = config.apiVersion ?? META_DEFAULT_API_VERSION;
    const data = events.map((e, i) => {
        if (!e.eventName || !e.eventId)
            throw new Error(`buildMetaConversionRequest: event ${i} needs eventName and eventId`);
        const t = e.eventTime instanceof Date ? e.eventTime.getTime() : Number.NaN;
        if (!Number.isFinite(t))
            throw new Error(`buildMetaConversionRequest: event ${i} has an invalid eventTime`);
        const userData = {};
        const em = e.email ? normalizeEmail("META", e.email) : null;
        const ph = e.phone ? normalizePhone("META", e.phone) : null;
        if (em)
            userData.em = [sha256Hex(em)];
        if (ph)
            userData.ph = [sha256Hex(ph)];
        if (e.externalId)
            userData.external_id = [hashExternalId(e.externalId.tenantId, e.externalId.subjectId)];
        if (e.fbc)
            userData.fbc = e.fbc;
        if (e.fbp)
            userData.fbp = e.fbp;
        const ev = {
            event_name: e.eventName,
            event_time: Math.floor(t / 1000),
            event_id: e.eventId,
            action_source: "website",
            user_data: userData,
        };
        if (e.eventSourceUrl)
            ev.event_source_url = e.eventSourceUrl;
        if (e.value) {
            if (!Number.isFinite(e.value.amount) || e.value.amount < 0)
                throw new Error(`buildMetaConversionRequest: event ${i} has an invalid value`);
            if (!/^[A-Z]{3}$/.test(e.value.currency))
                throw new Error(`buildMetaConversionRequest: event ${i} needs an ISO 4217 currency`);
            ev.custom_data = { value: e.value.amount, currency: e.value.currency };
        }
        return ev;
    });
    return { endpoint: `${trimSlash(config.apiBase ?? META_DEFAULT_API_BASE)}/${apiVersion}/${config.datasetId}/events`, apiVersion, request: { data } };
}
/** §4.5 Rev 3 item 3: parameter, token or permission codes are final. Everything else is unknown. */
function isFinalMetaCode(code) {
    return code === 100 || code === 102 || code === 190 || code === 10 || (code >= 200 && code <= 299);
}
function metaError(text) {
    const j = parseJsonSafe(text);
    return j && typeof j.error === "object" && j.error !== null ? j.error : null;
}
/**
 * The number of events in a frozen Conversions API body (`{ data: [...] }`), or null when the body is
 * not one. `buildMetaConversionRequest` always produces 1…1,000 events.
 */
function metaFrozenEventCount(batch) {
    const j = parseJsonSafe(new TextDecoder().decode(batch.body));
    return j && typeof j === "object" && Array.isArray(j.data) ? j.data.length : null;
}
/**
 * The Meta Conversions API classes (§4.5 Rev 3 item 3). Exported for tests.
 *
 * GD-2953: a 2xx is `accepted` only when `events_received` is an integer EQUAL to `expectedEvents`,
 * the number of events in the frozen batch. Any other value (0, negative, fractional, short, larger,
 * a string, null) is `unknown`, never `retryable`: Meta has no deduplication this design relies on for
 * a resend, so the caller must not resend (§4.5 Rev 3).
 */
export function classifyMetaConversion(r, expectedEvents) {
    if (r.kind === "transport_error") {
        return r.written ? { status: "unknown", reason: `meta_${r.reason}` } : { status: "retryable", reason: `meta_${r.reason}` };
    }
    if (r.status >= 200 && r.status < 300) {
        const j = parseJsonSafe(r.text);
        if (!j || typeof j !== "object" || !("events_received" in j))
            return { status: "unknown", reason: "meta_2xx_without_events_received" };
        if (Number.isInteger(expectedEvents) && expectedEvents > 0 && Number.isInteger(j.events_received) && j.events_received === expectedEvents) {
            return { status: "accepted", ...(typeof j.fbtrace_id === "string" ? { platformRef: j.fbtrace_id } : {}) };
        }
        return { status: "unknown", reason: "meta_events_received_mismatch" };
    }
    if (r.status >= 400 && r.status < 500 && r.status !== 429) {
        const err = metaError(r.text);
        if (err && typeof err.code === "number" && isFinalMetaCode(err.code))
            return { status: "rejected", reason: `meta_error_${err.code}` };
    }
    return { status: "unknown", reason: `meta_http_${r.status}` };
}
/** Audience calls are retried by their caller (a replace converges), so the classes are coarser. */
function classifyMetaAudienceCall(r) {
    if (r.kind === "transport_error") {
        return r.written ? { status: "unknown", reason: `meta_${r.reason}` } : { status: "retryable", reason: `meta_${r.reason}` };
    }
    if (r.status >= 200 && r.status < 300)
        return { status: "accepted" };
    const err = metaError(r.text);
    if (err?.error_subcode === 1870158)
        return { status: "unknown", reason: "meta_replace_session_timeout" };
    if (err?.error_subcode === 1870145)
        return { status: "retryable", reason: "meta_audience_update_in_progress" };
    if (r.status >= 400 && r.status < 500 && r.status !== 429 && err && typeof err.code === "number" && isFinalMetaCode(err.code)) {
        return { status: "rejected", reason: `meta_error_${err.code}` };
    }
    return { status: "unknown", reason: `meta_http_${r.status}` };
}
function toRows(members) {
    const usable = members.filter((m) => m && (m.email || m.phone));
    const schema = [];
    if (usable.some((m) => m.email))
        schema.push("EMAIL");
    if (usable.some((m) => m.phone))
        schema.push("PHONE");
    return { schema, data: usable.map((m) => schema.map((f) => (f === "EMAIL" ? (m.email ?? "") : (m.phone ?? "")))) };
}
function chunk(xs, n) {
    const out = [];
    for (let i = 0; i < xs.length; i += n)
        out.push(xs.slice(i, i + n));
    return out;
}
export function createMetaClient(config, options = {}) {
    const token = typeof config.accessToken === "string" ? config.accessToken.trim() : "";
    const base = trimSlash(config.apiBase ?? META_DEFAULT_API_BASE);
    const version = config.apiVersion ?? META_DEFAULT_API_VERSION;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const batchSize = Math.min(Math.max(1, Math.floor(options.batchSize ?? META_MEMBER_BATCH_LIMIT)), META_MEMBER_BATCH_LIMIT);
    const statusPollMs = options.statusPollMs ?? 30_000;
    const statusMaxReads = Math.max(1, options.statusMaxReads ?? 20);
    const sleep = options.sleep ?? realSleep;
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
    const audienceId = (list) => {
        const id = config.audienceIds?.[list];
        return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
    };
    const checkAdvertiser = (a) => !a || typeof a.tenantId !== "string" || a.tenantId.trim() === "" ? { status: "rejected", reason: "advertiser_tenant_required" } : null;
    /** DELETE /{audience}/users in batches. All ok → accepted; none → the first failure; some → partial. */
    const deleteMembers = async (aud, members) => {
        const { schema, data } = toRows(members);
        if (data.length === 0)
            return { status: "accepted" };
        let done = 0;
        let firstFailure = null;
        const batches = chunk(data, batchSize);
        for (const rows of batches) {
            const r = await httpRequest({
                url: `${base}/${version}/${encodeURIComponent(aud)}/users`,
                method: "DELETE",
                headers,
                body: JSON.stringify({ payload: { schema, data: rows } }),
                timeoutMs,
            });
            const o = classifyMetaAudienceCall(r);
            if (o.status === "accepted")
                done++;
            else
                firstFailure ??= o;
        }
        if (done === batches.length)
            return { status: "accepted" };
        if (done === 0 && firstFailure)
            return firstFailure;
        const reason = firstFailure && "reason" in firstFailure ? firstFailure.reason : "meta_delete_batch_failed";
        return { status: "partial", done, failed: batches.length - done, reason };
    };
    /** Reads operation_status until it leaves replace_in_progress. The JSON shape is unverified: read leniently. */
    const awaitReplace = async (aud) => {
        for (let read = 0; read < statusMaxReads; read++) {
            if (read > 0)
                await sleep(statusPollMs);
            const r = await httpRequest({
                url: `${base}/${version}/${encodeURIComponent(aud)}?fields=operation_status`,
                method: "GET",
                headers: { authorization: headers.authorization },
                timeoutMs,
            });
            if (r.kind !== "response" || r.status < 200 || r.status >= 300)
                continue;
            const os = parseJsonSafe(r.text)?.operation_status;
            const desc = (typeof os === "string" ? os : typeof os === "object" && os !== null ? String(os.description ?? "") : "").toLowerCase();
            const code = typeof os === "object" && os !== null ? Number(os.code) : Number.NaN;
            if (code === 471)
                return { status: "rejected", reason: "meta_audience_integrity_flag_471" };
            if (desc.includes("replace_error"))
                return { status: "partial", done: 0, failed: 1, reason: "meta_replace_error" };
            if (desc.includes("in_progress") || desc.includes("in progress"))
                continue;
            if (desc === "normal" || desc.startsWith("normal"))
                return { status: "accepted" };
        }
        return { status: "unknown", reason: "meta_replace_status_unresolved" };
    };
    return {
        platform: "META",
        async sendConversionBatch(advertiser, batch) {
            if (!token)
                return { status: "not_connected" };
            const bad = checkAdvertiser(advertiser);
            if (bad)
                return bad;
            if (!frozenBodyMatches(batch))
                return { status: "rejected", reason: "frozen_body_sha256_mismatch" };
            // A batch with no countable events could never be confirmed (0 === 0 must not read as accepted):
            // refused before any request, like a tampered body. buildMetaConversionRequest never builds one.
            const expectedEvents = metaFrozenEventCount(batch);
            if (expectedEvents === null || expectedEvents === 0)
                return { status: "rejected", reason: "meta_frozen_batch_has_no_events" };
            const r = await httpRequest({ url: batch.endpoint, method: "POST", headers, body: batch.body, timeoutMs });
            return classifyMetaConversion(r, expectedEvents);
        },
        async replaceAudience(advertiser, list, members, possiblyApplied) {
            const aud = audienceId(list);
            if (!token || !aud)
                return { status: "not_connected" };
            const bad = checkAdvertiser(advertiser);
            if (bad)
                return bad;
            // An empty target clears by DELETE of the possibly-applied set; never an empty usersreplace (§6.2 Rev 3).
            const { schema, data } = toRows(members);
            if (data.length === 0)
                return deleteMembers(aud, possiblyApplied);
            const sessionId = randomInt(1, 2 ** 47);
            const batches = chunk(data, batchSize);
            for (let i = 0; i < batches.length; i++) {
                const r = await httpRequest({
                    url: `${base}/${version}/${encodeURIComponent(aud)}/usersreplace`,
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        session: { session_id: sessionId, batch_seq: i + 1, last_batch_flag: i === batches.length - 1, estimated_num_total: data.length },
                        payload: { schema, data: batches[i] },
                    }),
                    timeoutMs,
                });
                const o = classifyMetaAudienceCall(r);
                if (o.status === "accepted")
                    continue;
                // A session timeout replaces the list "with what you've uploaded so far": PARTIAL, and the
                // next run's new full session converges (§6.2 Rev 2). Any later-batch failure is the same.
                if (i > 0 || (o.status === "unknown" && o.reason === "meta_replace_session_timeout")) {
                    return { status: "partial", done: i, failed: batches.length - i, reason: "reason" in o ? o.reason : "meta_replace_batch_failed" };
                }
                return o;
            }
            // replace_error: every batch was received, but Meta reports the replacement incomplete. PARTIAL;
            // the next run's full session converges.
            return awaitReplace(aud);
        },
        async removeFromAudience(advertiser, list, members) {
            const aud = audienceId(list);
            if (!token || !aud)
                return { status: "not_connected" };
            const bad = checkAdvertiser(advertiser);
            if (bad)
                return bad;
            return deleteMembers(aud, members);
        },
    };
}
