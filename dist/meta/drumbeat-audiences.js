/**
 * MOVED from The-Drumbeat `src/lib/meta/audiences.ts` @ 960ea5e629bbdbf2b7fa505a4f3b2521f1b6843d
 * (S12a), behaviour unchanged. The ONLY change: the Prisma connection lookup and token decryption
 * stay in the Drumbeat, which now passes `{ accessToken, adAccountId }` in. Everything from
 * BATCH_SIZE to the end of `projectMembersToMetaPayload` is the Drumbeat's text, verbatim, and the
 * two network functions keep its URLs, bodies, headers, timeout, errors and logs.
 *
 * This is the Graph API v21.0 custom-audience ADD path the Drumbeat uses. Rello's S12 clients
 * (remove / usersreplace / clear) are in `./client.ts`.
 */
import * as crypto from "crypto";
// v19.0 expired 2026-05-21 (Graph API changelog). Calls to an expired version
// are silently auto-upgraded by Meta to the oldest live version, so the wire
// behaviour of this file was undefined rather than pinned. v21.0 is live until
// 2027-01-21 and is what the rest of this repo's Meta surfaces already use
// (webhooks/meta-leads, social-accounts, oauth token exchange).
export const DRUMBEAT_GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const GRAPH_API_BASE = DRUMBEAT_GRAPH_API_BASE;
// MOVED from The-Drumbeat `src/lib/meta/ad-account.ts` (the two pure helpers; its Prisma writer stays).
const NODE_PREFIX = "act_";
/** The numeric ad-account id, given either Meta form. */
export function canonicalMetaAdAccountId(id) {
    return id.startsWith(NODE_PREFIX) ? id.slice(NODE_PREFIX.length) : id;
}
/** The Graph path segment for a stored ad-account id: always `act_<numeric>`. */
export function metaAdAccountNode(storedAccountId) {
    return `${NODE_PREFIX}${canonicalMetaAdAccountId(storedAccountId)}`;
}
const BATCH_SIZE = 10_000;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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
const META_SCHEMA_FIELDS = [
    "EMAIL",
    "PHONE",
    "FN",
    "LN",
    "CT",
    "ST",
    "ZIP",
];
/**
 * SHA-256 hex digest. Callers MUST pass an already-normalized value — this
 * helper deliberately does no normalization of its own, because Meta's rules
 * differ per field and a blanket `toLowerCase().trim()` silently produces
 * unmatchable hashes for names, cities and phone numbers.
 */
function sha256Hex(normalized) {
    return crypto.createHash("sha256").update(normalized).digest("hex");
}
/**
 * Meta: "Use `a`-`z` only. Lowercase only, no punctuation." Applies to FN, LN
 * and CT. Special characters are kept in UTF-8 form (Meta's stated rule for
 * names), so we strip on the Unicode letter class rather than ASCII.
 */
function normalizeLetters(value) {
    return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}]/gu, "");
}
/** Meta: "Trim leading and trailing white space, and convert to lowercase." */
function normalizeEmail(value) {
    const v = value.trim().toLowerCase();
    // A value with no local@domain shape is an invalid entry on Meta's side; drop
    // it rather than burning a row on a hash that can never match.
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : "";
}
/**
 * Meta: "Remove symbols, letters, and any leading zeroes. You should prefix the
 * country code if the COUNTRY field is not specified."
 *
 * We do not synthesize a country code — inventing one would produce a confident
 * wrong hash. Callers that hold non-US numbers must supply them already
 * country-prefixed.
 */
function normalizePhone(value) {
    const digits = value.replace(/\D/g, "").replace(/^0+/, "");
    // Shorter than a subscriber number — cannot match; drop rather than upload.
    return digits.length >= 7 ? digits : "";
}
/**
 * Meta: "Use the 2-character ANSI abbreviation code, lowercase." Anything that
 * does not normalize to exactly two letters is dropped for that member instead
 * of being uploaded as an entry Meta will reject.
 */
function normalizeState(value) {
    const v = normalizeLetters(value);
    return v.length === 2 ? v : "";
}
/**
 * Meta: "Use lowercase, and no white space. For the US, use only the first 5
 * digits. For the UK, use the Area/District/Sector format."
 *
 * All-digit values are treated as US and truncated to 5 (handles ZIP+4);
 * alphanumeric values (UK and similar) are passed through normalized, not
 * truncated.
 */
function normalizeZip(value) {
    const v = value.normalize("NFKC").toLowerCase().replace(/[\s.-]/g, "");
    return /^\d+$/.test(v) ? v.slice(0, 5) : v;
}
/**
 * Normalize one member to plaintext-per-field. `""` means "not supplied" and
 * becomes an empty positional slot (never a hash of the empty string, which
 * would be a real digest Meta would try — and fail — to match).
 */
function normalizeMember(member) {
    return {
        EMAIL: member.email ? normalizeEmail(member.email) : "",
        PHONE: member.phone ? normalizePhone(member.phone) : "",
        FN: member.firstName ? normalizeLetters(member.firstName) : "",
        LN: member.lastName ? normalizeLetters(member.lastName) : "",
        CT: member.city ? normalizeLetters(member.city) : "",
        ST: member.state ? normalizeState(member.state) : "",
        ZIP: member.zip ? normalizeZip(member.zip) : "",
    };
}
/**
 * Project audience members into Meta's positional `schema` / `data` upload
 * shape. Exported for unit test — this is the contract the whole upload rests
 * on, so it is asserted directly rather than through a mocked fetch.
 *
 * Columns no member supplies are omitted entirely: uploading an all-empty ZIP
 * column costs bytes and matches nothing.
 */
export function projectMembersToMetaPayload(members) {
    const normalized = members.map(normalizeMember);
    const schema = META_SCHEMA_FIELDS.filter((field) => normalized.some((row) => row[field] !== ""));
    if (schema.length === 0) {
        return { schema: [], data: [], skipped: normalized.length };
    }
    const data = [];
    let skipped = 0;
    for (const row of normalized) {
        // A row with nothing in any emitted column is an invalid entry on Meta's
        // side — drop it here so `num_received` reflects real members.
        if (schema.every((field) => row[field] === "")) {
            skipped++;
            continue;
        }
        data.push(schema.map((field) => (row[field] ? sha256Hex(row[field]) : "")));
    }
    return { schema, data, skipped };
}
// ---------------------------------------------------------------------------
// Create custom audience
// ---------------------------------------------------------------------------
/**
 * Create a custom audience via Meta Graph API.
 */
export async function createMetaCustomAudience(credentials, name, description) {
    const { accessToken } = credentials;
    const res = await fetch(`${GRAPH_API_BASE}/${metaAdAccountNode(credentials.adAccountId)}/customaudiences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name,
            description,
            subtype: "CUSTOM",
            customer_file_source: "USER_PROVIDED_ONLY",
            access_token: accessToken,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Meta custom audience creation failed (${res.status}): ${body}`);
    }
    const data = (await res.json());
    return { externalAudienceId: data.id };
}
// ---------------------------------------------------------------------------
// Sync audience members
// ---------------------------------------------------------------------------
/**
 * Upload hashed member data to a custom audience in batches of 10k.
 */
export async function syncAudienceMembers(credentials, externalAudienceId, members) {
    const { accessToken } = credentials;
    const { schema, data: rows, skipped } = projectMembersToMetaPayload(members);
    if (skipped > 0) {
        console.warn(`[meta/audiences] audience=${externalAudienceId}: skipped ${skipped} member(s) with no usable identifier after normalization`);
    }
    // Nothing hashable — posting an empty schema is a guaranteed Meta 400. An
    // audience whose members carry no PII is a valid state, not a failure.
    if (schema.length === 0 || rows.length === 0) {
        console.info(`[meta/audiences] audience=${externalAudienceId}: no uploadable members (${members.length} in, ${skipped} skipped)`);
        return { uploaded: 0, batches: 0 };
    }
    let uploaded = 0;
    let batches = 0;
    // Process members in batches of BATCH_SIZE
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const batchNumber = batches + 1;
        let res;
        try {
            res = await fetch(`${GRAPH_API_BASE}/${externalAudienceId}/users`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    payload: {
                        // Positional arrays aligned to `schema` — Meta rejects keyed
                        // objects here (they upload as 0 matched users).
                        schema,
                        data: batch,
                    },
                    access_token: accessToken,
                }),
                signal: AbortSignal.timeout(60_000),
            });
        }
        catch (err) {
            console.error(`[meta/audiences] network error uploading batch ${batchNumber} to audience=${externalAudienceId}:`, err);
            throw new Error(`Meta audience member upload failed batch ${batchNumber} (network): ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.error(`[meta/audiences] non-ok status=${res.status} batch=${batchNumber} audience=${externalAudienceId} body=${body.slice(0, 300)}`);
            throw new Error(`Meta audience member upload failed batch ${batchNumber} (${res.status}): ${body}`);
        }
        const data = (await res.json().catch(() => ({})));
        // Meta omits these on some responses — never let an absent count poison the
        // running total with NaN.
        const received = typeof data.num_received === "number" ? data.num_received : batch.length;
        const invalid = typeof data.num_invalid_entries === "number" ? data.num_invalid_entries : 0;
        uploaded += received;
        batches++;
        console.info(`[meta/audiences] Batch ${batches}: uploaded ${received}, invalid ${invalid}`);
    }
    return { uploaded, batches };
}
