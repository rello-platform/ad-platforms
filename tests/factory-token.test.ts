/**
 * createAdPlatformClient(platform, env) and the not-connected client (§7.1 Rev 4, §7.3 Rev 5):
 * missing credentials are `not_connected` with 0 network calls, never an error.
 * And the Google service-account token source.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFakeAdServer, type FakeAdServer } from "../src/fake/index.js";
import {
  createAdPlatformClient,
  notConnectedClient,
  readHouseAdConfig,
  serviceAccountTokenSource,
  buildMetaConversionRequest,
  buildGoogleConversionRequest,
  createMetaClient,
  freezeBatch,
  hashMember,
  type AdPlatformClient,
  type Platform,
} from "../src/index.js";
import { testServiceAccount, noSleep } from "./helpers.js";

const HOUSE = { tenantId: "tenant_rello_growth" };
let fake: FakeAdServer;
let sa: { json: string; publicKey: string };
beforeAll(async () => {
  // The fake verifies the JWT signature; the key is generated per run and never leaves the test.
  sa = testServiceAccount("http://placeholder.invalid/oauth2/token");
  fake = await startFakeAdServer({ serviceAccountPublicKey: sa.publicKey });
  sa = { ...sa, json: sa.json.replace(/"token_uri":"[^"]*"/, `"token_uri":"${fake.tokenUri}"`) };
});
afterAll(async () => {
  await fake.close();
});

async function allFour(client: AdPlatformClient, platform: Platform) {
  const b = freezeBatch({ id: "nc", endpoint: `${fake.url}/never`, apiVersion: "v", request: { a: 1 } });
  const members = [hashMember(platform, { email: "a@example.com" })!];
  return [
    await client.sendConversionBatch(HOUSE, b),
    await client.replaceAudience(HOUSE, "rello_prospects", members, []),
    await client.removeFromAudience(HOUSE, "rello_prospects", members),
    await client.replaceAudience(HOUSE, "rello_prospects", [], members),
  ];
}

describe("not connected: 0 requests", () => {
  for (const platform of ["META", "GOOGLE"] as const) {
    it(`${platform}: no credentials → every operation is not_connected and the fake sees 0 requests`, async () => {
      const env = { ADS_META_API_BASE: fake.metaBase, ADS_GOOGLE_DATAMANAGER_API_BASE: fake.googleBase };
      const before = fake.requests.length;
      const outs = await allFour(createAdPlatformClient(platform, env, { sleep: noSleep }), platform);
      expect(outs).toEqual([{ status: "not_connected" }, { status: "not_connected" }, { status: "not_connected" }, { status: "not_connected" }]);
      expect(fake.requests.length).toBe(before);
    });

    it(`${platform}: notConnectedClient answers not_connected for everything, with 0 requests`, async () => {
      const before = fake.requests.length;
      const c = notConnectedClient(platform);
      expect(c.platform).toBe(platform);
      const outs = await allFour(c, platform);
      expect(outs.every((o) => o.status === "not_connected")).toBe(true);
      if (platform === "GOOGLE") expect(await c.requestStatus!(HOUSE, "x")).toBe("UNREADABLE");
      expect(fake.requests.length).toBe(before);
    });
  }

  it("the Meta client layer alone (no factory in front): a blank token is not_connected with 0 requests", async () => {
    // Pins the client's own guard. The factory never builds a client without a token, so a factory
    // test cannot see this guard removed (two guard layers would mask each other's mutants).
    const before = fake.requests.length;
    const c = createMetaClient({ accessToken: "  ", apiBase: fake.metaBase, audienceIds: { rello_prospects: "aud-nc" } }, { sleep: noSleep, statusPollMs: 0 });
    const outs = await allFour(c, "META");
    expect(outs).toEqual([{ status: "not_connected" }, { status: "not_connected" }, { status: "not_connected" }, { status: "not_connected" }]);
    expect(fake.requests.length).toBe(before);
  });

  it("an empty-string credential is the same as a missing one", async () => {
    const before = fake.requests.length;
    const outs = await allFour(createAdPlatformClient("META", { ADS_HOUSE_META_CAPI_TOKEN: "  ", ADS_META_API_BASE: fake.metaBase }, { sleep: noSleep }), "META");
    expect(outs.every((o) => o.status === "not_connected")).toBe(true);
    expect(fake.requests.length).toBe(before);
  });
});

describe("connected from the house env names", () => {
  it("META: a token sends conversions; a list without an audience id stays not_connected", async () => {
    const env = {
      ADS_HOUSE_META_CAPI_TOKEN: "meta-house-test-token",
      ADS_HOUSE_META_DATASET_ID: "house-ds",
      ADS_HOUSE_META_AUDIENCE_RELLO_PROSPECTS: "house-aud-1",
      ADS_META_API_BASE: fake.metaBase,
    };
    const cfg = readHouseAdConfig(env);
    expect(cfg.meta).toEqual({ apiBase: fake.metaBase, apiVersion: "v21.0", datasetId: "house-ds", adAccountId: undefined, audienceIds: { rello_prospects: "house-aud-1" } });
    const client = createAdPlatformClient("META", env, { sleep: noSleep, statusPollMs: 0 });
    const req = buildMetaConversionRequest(
      { apiBase: cfg.meta.apiBase, apiVersion: cfg.meta.apiVersion, datasetId: cfg.meta.datasetId! },
      [{ eventName: "CompleteRegistration", eventTime: new Date(), eventId: "rello:signup:t1", email: "x@example.com" }],
    );
    expect((await client.sendConversionBatch(HOUSE, freezeBatch({ id: "m1", ...req }))).status).toBe("accepted");
    const before = fake.requests.length;
    const member = [hashMember("META", { email: "a@example.com" })!];
    expect(await client.replaceAudience(HOUSE, "rello_customers", member, [])).toEqual({ status: "not_connected" });
    expect(fake.requests.length).toBe(before);
    expect((await client.replaceAudience(HOUSE, "rello_prospects", member, [])).status).toBe("accepted");
  });

  it("GOOGLE: service-account credentials mint a token at the fake (signature verified) and send", async () => {
    const env = {
      ADS_GOOGLE_CREDENTIALS_JSON: sa.json,
      ADS_HOUSE_GOOGLE_CUSTOMER_ID: "123-456-7890",
      ADS_HOUSE_GOOGLE_CONVERSION_ACTION_SIGNUP: "act-signup",
      ADS_HOUSE_GOOGLE_USER_LIST_RELLO_PROSPECTS: "ul-house",
      ADS_GOOGLE_DATAMANAGER_API_BASE: fake.googleBase,
    };
    const cfg = readHouseAdConfig(env);
    expect(cfg.google).toEqual({
      apiBase: fake.googleBase,
      operatingAccountId: "1234567890",
      loginAccountId: undefined,
      conversionActionIds: { signup: "act-signup" },
      userListIds: { rello_prospects: "ul-house" },
    });
    const client = createAdPlatformClient("GOOGLE", env, { sleep: noSleep, statusPollMs: 0 });
    const req = buildGoogleConversionRequest(
      { apiBase: cfg.google.apiBase, operatingAccountId: cfg.google.operatingAccountId! },
      { conversionActionId: "act-signup", events: [{ transactionId: "rello:signup:t2", eventTime: new Date(), email: "y@example.com" }] },
    );
    const tokensBefore = fake.requestsOn("oauth.token").length;
    expect((await client.sendConversionBatch(HOUSE, freezeBatch({ id: "g1", ...req }))).status).toBe("accepted");
    expect((await client.replaceAudience(HOUSE, "rello_prospects", [hashMember("GOOGLE", { email: "z@example.com" })!], [])).status).toBe("accepted");
    // One token for the client's lifetime while it is valid.
    expect(fake.requestsOn("oauth.token").length).toBe(tokensBefore + 1);
    const ev = fake.requestsOn("google.events").at(-1)!;
    expect(ev.headers.authorization).toMatch(/^Bearer fake-access-\d+$/);
  });
});

describe("house env names are exactly §7.3 Rev 5's", () => {
  it("reads conversion actions for SIGNUP and LEAD only", () => {
    const cfg = readHouseAdConfig({
      ADS_HOUSE_GOOGLE_CONVERSION_ACTION_SIGNUP: "a1",
      ADS_HOUSE_GOOGLE_CONVERSION_ACTION_LEAD: "a2",
      ADS_HOUSE_GOOGLE_CONVERSION_ACTION_FUNDED_LOAN: "a3",
      ADS_HOUSE_GOOGLE_CONVERSION_ACTION_FUNDED_LOAN_RETRACT: "a4",
    });
    expect(cfg.google.conversionActionIds).toEqual({ signup: "a1", lead: "a2" });
  });
});

describe("serviceAccountTokenSource", () => {
  it("asks for the datamanager scope, with a JWT the fake verifies", async () => {
    const get = serviceAccountTokenSource(sa.json);
    const t = await get();
    expect(t).toMatch(/^fake-access-\d+$/);
    const assertion = new URLSearchParams(fake.requestsOn("oauth.token").at(-1)!.body.toString()).get("assertion")!;
    const claims = JSON.parse(Buffer.from(assertion.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    expect(claims.scope).toBe("https://www.googleapis.com/auth/datamanager");
    expect(claims.aud).toBe(fake.tokenUri);
    expect(claims.iss).toBe("s12a-test@fake.iam.example");
    expect(await get()).toBe(t);
  });

  it("a wrong key fails with an error that names no secret", async () => {
    const other = testServiceAccount(fake.tokenUri);
    const get = serviceAccountTokenSource(other.json);
    const err = await get().then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/token/i);
    expect(err!.message).not.toContain("PRIVATE KEY");
  });

  it("malformed credentials JSON throws at construction without echoing it", () => {
    expect(() => serviceAccountTokenSource("{not json")).toThrow(/credentials/i);
    expect(() => serviceAccountTokenSource(JSON.stringify({ client_email: "x" }))).toThrow(/credentials/i);
  });
});
