/**
 * The house client from env (S12 design §7.3 Rev 5), and the not-connected client (§7.1 Rev 4).
 * Missing or blank credentials give a client whose every operation is `not_connected` and which
 * makes 0 network calls. Credentials are read here and passed to the clients; nothing is stored.
 */
import { AD_AUDIENCE_LISTS, AD_CONVERSION_KINDS } from "./registries.js";
import { createMetaClient, META_DEFAULT_API_BASE, META_DEFAULT_API_VERSION } from "./meta/client.js";
import { createGoogleClient, GOOGLE_DATAMANAGER_DEFAULT_API_BASE } from "./google/client.js";
import { serviceAccountTokenSource } from "./google/token.js";
const val = (env, name) => {
    const v = env[name];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const digits = (v) => (v ? v.replace(/-/g, "") : undefined);
/** House lists: the registry's house-scoped lists (§7.3 Rev 5 names RELLO_PROSPECTS and RELLO_CUSTOMERS). */
const HOUSE_LISTS = Object.entries(AD_AUDIENCE_LISTS).filter(([, e]) => e.scope === "house").map(([k]) => k);
/**
 * §7.3 Rev 5 names house conversion actions for SIGNUP and LEAD only. funded_loan is an any-scope
 * kind, but the design gives the house no env name for it, so none is read here.
 */
const HOUSE_KINDS = ["signup", "lead"].filter((k) => k in AD_CONVERSION_KINDS);
function byKey(env, prefix, keys) {
    const out = {};
    for (const k of keys) {
        const v = val(env, `${prefix}${k.toUpperCase()}`);
        if (v)
            out[k] = v;
    }
    return out;
}
/** The non-secret house ids. Never returns a token or the credentials JSON. */
export function readHouseAdConfig(env) {
    return {
        meta: {
            apiBase: val(env, "ADS_META_API_BASE") ?? META_DEFAULT_API_BASE,
            apiVersion: META_DEFAULT_API_VERSION,
            datasetId: val(env, "ADS_HOUSE_META_DATASET_ID"),
            adAccountId: val(env, "ADS_HOUSE_META_AD_ACCOUNT_ID"),
            audienceIds: byKey(env, "ADS_HOUSE_META_AUDIENCE_", HOUSE_LISTS),
        },
        google: {
            apiBase: val(env, "ADS_GOOGLE_DATAMANAGER_API_BASE") ?? GOOGLE_DATAMANAGER_DEFAULT_API_BASE,
            operatingAccountId: digits(val(env, "ADS_HOUSE_GOOGLE_CUSTOMER_ID")),
            loginAccountId: digits(val(env, "ADS_HOUSE_GOOGLE_LOGIN_CUSTOMER_ID")),
            conversionActionIds: byKey(env, "ADS_HOUSE_GOOGLE_CONVERSION_ACTION_", HOUSE_KINDS),
            userListIds: byKey(env, "ADS_HOUSE_GOOGLE_USER_LIST_", HOUSE_LISTS),
        },
    };
}
const NOT_CONNECTED = { status: "not_connected" };
export function notConnectedClient(platform) {
    const nc = async () => ({ ...NOT_CONNECTED });
    return {
        platform,
        sendConversionBatch: nc,
        replaceAudience: nc,
        removeFromAudience: nc,
        ...(platform === "GOOGLE" ? { requestStatus: async () => "UNREADABLE" } : {}),
    };
}
export function createAdPlatformClient(platform, env, options = {}) {
    const cfg = readHouseAdConfig(env);
    if (platform === "META") {
        const token = val(env, "ADS_HOUSE_META_CAPI_TOKEN");
        if (!token)
            return notConnectedClient("META");
        return createMetaClient({ accessToken: token, apiBase: cfg.meta.apiBase, apiVersion: cfg.meta.apiVersion, audienceIds: cfg.meta.audienceIds }, options);
    }
    const credentials = val(env, "ADS_GOOGLE_CREDENTIALS_JSON");
    if (!credentials || !cfg.google.operatingAccountId)
        return notConnectedClient("GOOGLE");
    let getAccessToken;
    try {
        getAccessToken = serviceAccountTokenSource(credentials, { timeoutMs: options.timeoutMs });
    }
    catch (err) {
        // The message names the missing field, never the JSON or the key.
        console.error(`[ad-platforms] ADS_GOOGLE_CREDENTIALS_JSON unusable, Google is not connected: ${err instanceof Error ? err.message : "unknown"}`);
        return notConnectedClient("GOOGLE");
    }
    return createGoogleClient({ getAccessToken, apiBase: cfg.google.apiBase, operatingAccountId: cfg.google.operatingAccountId, loginAccountId: cfg.google.loginAccountId, userListIds: cfg.google.userListIds }, options);
}
