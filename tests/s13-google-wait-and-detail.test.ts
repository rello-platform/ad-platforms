/**
 * v0.2.0 (Platform KA prompt 2138; design note S13-CONSENT-AND-GOOGLE-WAIT-261127 §4), red first against v0.1.0:
 *
 *   1. THE WAIT. A Google client has no default wait: `sleep` is required, so nothing falls into v0.1.0's plain
 *      30-minute timer inside a Trigger.dev task (maxDuration 900). Every status wait goes through the caller's sleep.
 *   2. THE TOKEN. A token is asked for before every status read (the reads can span 6 h; a token lives 1 h), and a
 *      read with no token is UNREADABLE, never a pass.
 *   3. THE DETAIL. A refused request keeps what Google said, masked: field paths, UPPER_SNAKE reasons, the message
 *      with every address, id, hash and token replaced. The outcome's `reason` is still the fixed code.
 *
 * Markers are generated in memory and checked as booleans, so a failure never prints one.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeAdServer, type FakeAdServer } from "../src/fake/index.js";
import { createAdPlatformClient, createGoogleClient, hashMember, type HashedMember, type Sleep } from "../src/index.js";
import { googleErrorDetail, maskPlatformText } from "../src/google/error-detail.js";
import { noSleep } from "./helpers.js";

const HOUSE = { tenantId: "tenant_rello_growth" };
let fake: FakeAdServer;
beforeAll(async () => {
  fake = await startFakeAdServer();
});
afterAll(async () => {
  await fake.close();
});

let seq = 0;
const listIds = () => {
  const remoteId = `s13-list-${++seq}`;
  return { remoteId, userListIds: { rello_prospects: remoteId } };
};
const member = (email: string): HashedMember => hashMember("GOOGLE", { email })!;
const onList = (route: Parameters<FakeAdServer["requestsOn"]>[0], remoteId: string) => fake.requestsOn(route).filter((r) => r.body.toString().includes(remoteId));
const statusReads = (before: number) => fake.requestsOn("google.status").slice(before);
const mk = () => `mk${randomBytes(16).toString("hex")}`;
const CANONICAL = new Set(["INVALID_ARGUMENT", "RESOURCE_EXHAUSTED", "PERMISSION_DENIED"]);

describe("1. the wait: required, and the caller's", () => {
  it("createGoogleClient with no sleep throws at once (a JavaScript caller with no type check)", () => {
    const { userListIds } = listIds();
    const make = () =>
      createGoogleClient(
        { getAccessToken: async () => "t", apiBase: fake.googleBase, operatingAccountId: "1234567890", userListIds },
        // @ts-expect-error — v0.2.0: sleep is required; this is the JavaScript caller the runtime check is for.
        { timeoutMs: 400 },
      );
    expect(make).toThrow(TypeError);
    // @ts-expect-error — no options at all.
    expect(() => createGoogleClient({ getAccessToken: async () => "t", apiBase: fake.googleBase, operatingAccountId: "1234567890" })).toThrow(TypeError);
  });

  it("createAdPlatformClient with no sleep throws, for either platform, before reading any credential", () => {
    // @ts-expect-error — v0.2.0: options with sleep are required.
    expect(() => createAdPlatformClient("GOOGLE", {})).toThrow(TypeError);
    // @ts-expect-error — the same for Meta (30 s polls are a plain wait too).
    expect(() => createAdPlatformClient("META", {})).toThrow(TypeError);
    expect(createAdPlatformClient("GOOGLE", {}, { sleep: noSleep }).platform).toBe("GOOGLE");
  });

  it("a replace waits only through the caller's sleep: statusPollMs (30 min by default) before each status read", async () => {
    const { remoteId, userListIds } = listIds();
    const waits: number[] = [];
    const sleep: Sleep = async (ms) => void waits.push(ms);
    const client = createGoogleClient({ getAccessToken: async () => "t", apiBase: fake.googleBase, operatingAccountId: "1234567890", userListIds }, { timeoutMs: 1000, sleep });
    const before = fake.requestsOn("google.status").length;
    fake.google.scriptNextRequest(["PROCESSING", "SUCCESS"]); // the ingest: two reads; the removeAll: one
    const out = await client.replaceAudience(HOUSE, "rello_prospects", [member("s13-wait@example.com")], []);
    expect(out.status).toBe("accepted");
    expect(statusReads(before)).toHaveLength(3);
    expect(waits).toEqual([1_800_000, 1_800_000, 1_800_000]);
    expect(onList("google.removeAll", remoteId)).toHaveLength(1);
  });
});

describe("2. the token: fresh for every status read", () => {
  it("each status read asks the token source again and carries what it got", async () => {
    const { userListIds } = listIds();
    let n = 0;
    const getAccessToken = async () => `tok-${++n}`;
    const client = createGoogleClient({ getAccessToken, apiBase: fake.googleBase, operatingAccountId: "1234567890", userListIds }, { timeoutMs: 1000, sleep: noSleep, statusPollMs: 0 });
    const before = fake.requestsOn("google.status").length;
    fake.google.scriptNextRequest(["PROCESSING", "PROCESSING", "SUCCESS"]);
    const out = await client.removeFromAudience(HOUSE, "rello_prospects", [member("s13-tok@example.com")]);
    expect(out.status).toBe("accepted");
    const auth = statusReads(before).map((r) => String(r.headers.authorization ?? ""));
    expect(auth).toHaveLength(3);
    expect(new Set(auth).size).toBe(3); // three reads, three asks: never the write's token reused
    expect(auth.every((a) => /^Bearer tok-\d+$/.test(a))).toBe(true);
  });

  it("a token that can no longer be had makes the read UNREADABLE: the write is never reported done", async () => {
    const { userListIds } = listIds();
    let calls = 0;
    const getAccessToken = async () => {
      calls++;
      if (calls === 1) return "tok-only-once";
      throw new Error("token endpoint down");
    };
    const client = createGoogleClient({ getAccessToken, apiBase: fake.googleBase, operatingAccountId: "1234567890", userListIds }, { timeoutMs: 1000, sleep: noSleep, statusPollMs: 0, statusMaxReads: 2 });
    const before = fake.requestsOn("google.status").length;
    const out = await client.removeFromAudience(HOUSE, "rello_prospects", [member("s13-expired@example.com")]);
    expect(out.status).toBe("unknown");
    expect(statusReads(before)).toHaveLength(0); // no read went out with no token, and none with the stale one
  });

  it("the removeAll after an ingest's status reads asks for its own token", async () => {
    const { remoteId, userListIds } = listIds();
    let n = 0;
    const client = createGoogleClient(
      { getAccessToken: async () => `tok-${++n}`, apiBase: fake.googleBase, operatingAccountId: "1234567890", userListIds },
      { timeoutMs: 1000, sleep: noSleep, statusPollMs: 0 },
    );
    const out = await client.replaceAudience(HOUSE, "rello_prospects", [member("s13-ra@example.com")], []);
    expect(out.status).toBe("accepted");
    const ingestAuth = String(onList("google.ingest", remoteId)[0]?.headers.authorization ?? "");
    const removeAllAuth = String(onList("google.removeAll", remoteId)[0]?.headers.authorization ?? "");
    const num = (a: string) => Number(/^Bearer tok-(\d+)$/.exec(a)?.[1] ?? Number.NaN);
    expect(Number.isFinite(num(ingestAuth))).toBe(true);
    // A token the source handed out AFTER the ingest's own: asked for again, not reused and not invented.
    expect(num(removeAllAuth)).toBeGreaterThan(num(ingestAuth));
  });
});

/** What a refused removeAll looks like: Google's error body with a BadRequest and an ErrorInfo detail. */
function refusal(marker: string) {
  return {
    error: {
      code: 400,
      status: "INVALID_ARGUMENT",
      message: `Request contains an invalid argument. Customer 2795163852 list 9876543210 for a.person@gmail.com, token ya29.${marker}`,
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.BadRequest",
          fieldViolations: [
            { field: "destinations[0].productDestinationId", reason: "INVALID_CONVERSION_ACTION_ID", description: `User list 9876543210 not found for ${marker}@example.com` },
            { field: `not a path ${marker}`, reason: `lower ${marker}`, description: "" },
          ],
        },
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "INVALID_ARGUMENT", domain: "datamanager.googleapis.com", metadata: { secret: marker } },
      ],
    },
  };
}

describe("3. the detail: kept, masked", () => {
  it("a refused clear (an empty replace, S13's two refusals) keeps the field path, reasons and the masked message", async () => {
    const marker = mk();
    const { userListIds } = listIds();
    const client = createGoogleClient({ getAccessToken: async () => "t", apiBase: fake.googleBase, operatingAccountId: "2795163852", userListIds }, { timeoutMs: 1000, sleep: noSleep, statusPollMs: 0 });
    fake.next("google.removeAll", { kind: "status", status: 400, body: refusal(marker) });
    const out = await client.replaceAudience(HOUSE, "rello_prospects", [], []);
    expect(JSON.stringify(out).includes(marker)).toBe(false);
    expect(out).toEqual({
      status: "rejected",
      reason: "google_INVALID_ARGUMENT",
      detail: {
        httpStatus: 400,
        status: "INVALID_ARGUMENT",
        message: "Request contains an invalid argument. Customer <id> list <id> for <email>, token ya29.<token>",
        fieldViolations: [
          { field: "destinations[0].productDestinationId", reason: "INVALID_CONVERSION_ACTION_ID", description: "User list <id> not found for <email>" },
          { field: "<unrecognized_field>" },
        ],
        errorInfo: { reason: "INVALID_ARGUMENT", domain: "datamanager.googleapis.com" },
      },
    });
  });

  it("a refused second write batch is PARTIAL and keeps its detail (the first batch counted done)", async () => {
    const marker = mk();
    const { userListIds } = listIds();
    const client = createGoogleClient(
      { getAccessToken: async () => "t", apiBase: fake.googleBase, operatingAccountId: "1234567890", userListIds },
      { timeoutMs: 1000, sleep: noSleep, statusPollMs: 0, batchSize: 1 },
    );
    fake.next("google.remove", { kind: "stall", ms: 0 }); // batch 1: applied and answered normally
    fake.next("google.remove", { kind: "status", status: 400, body: refusal(marker) }); // batch 2: refused
    const out = await client.removeFromAudience(HOUSE, "rello_prospects", [member("s13-r1@example.com"), member("s13-r2@example.com")]);
    expect(JSON.stringify(out).includes(marker)).toBe(false);
    expect(out).toMatchObject({ status: "partial", done: 1, failed: 1, reason: "google_INVALID_ARGUMENT" });
    expect("detail" in out ? out.detail?.fieldViolations?.[0]?.field : undefined).toBe("destinations[0].productDestinationId");
  });

  it("an answer that is not Google's error shape keeps only the HTTP status", () => {
    expect(googleErrorDetail(502, undefined, CANONICAL)).toEqual({ httpStatus: 502 });
    expect(googleErrorDetail(500, { error: "plain text" }, CANONICAL)).toEqual({ httpStatus: 500 });
    const hostile = { get error() { throw new Error("getter"); } };
    expect(googleErrorDetail(400, hostile, CANONICAL)).toEqual({ httpStatus: 400 });
  });

  it("at most 10 field violations; a non-canonical status is dropped", () => {
    const d = googleErrorDetail(400, { error: { status: "NOT_A_CODE", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: Array.from({ length: 15 }, (_, i) => ({ field: `audienceMembers[${i}].userData` })) }] } }, CANONICAL);
    expect(d.status).toBeUndefined();
    expect(d.fieldViolations).toHaveLength(10);
    expect(d.fieldViolations?.[9]).toEqual({ field: "audienceMembers[9].userData" });
  });
});

describe("maskPlatformText", () => {
  it.each([
    ["an e-mail", "for Owner.Name+x@sub.example.co.uk now", "for <email> now"],
    ["a UUID", "request 3f2b1c4d-1a2b-4c3d-8e9f-0123456789ab failed", "request <id> failed"],
    ["a phone", "number +1 (801) 555-0142 is bad", "number <id> is bad"],
    ["a customer id with hyphens", "customer 279-516-3852", "customer <id>"],
    ["a sha256", `hash ${"ab".repeat(32)} unknown`, "hash <hex> unknown"],
    ["an access token", "bearer ya29.a0AfB_byC1x2y3z4w5v6u7t8s9r0q", "bearer ya29.<token>"],
    ["a long digit run", "list 9876543210", "list <id>"],
    ["a six-digit run", "account 123456", "account <id>"],
    ["control characters", "line one\nline\ttwo\u0000", "line one line two"],
  ])("masks %s", (_label, text, want) => {
    expect(maskPlatformText(text)).toBe(want);
  });

  it("keeps ordinary words, field paths and short numbers", () => {
    expect(maskPlatformText("destinations[0].productDestinationId must be set; at most 10000 members")).toBe("destinations[0].productDestinationId must be set; at most 10000 members");
    expect(maskPlatformText("customerMatchTermsOfServiceStatus is required")).toBe("customerMatchTermsOfServiceStatus is required");
  });

  it("cuts at 300 characters after masking; a non-string or empty text is undefined", () => {
    const out = maskPlatformText("x ".repeat(400))!;
    expect(out.length).toBe(300);
    expect(out.endsWith("…")).toBe(true);
    expect(maskPlatformText(42)).toBeUndefined();
    expect(maskPlatformText("   ")).toBeUndefined();
  });

  it("a marker mixing letters and digits never survives, wherever it sits", () => {
    // Not even a fragment: the masker once let "mkb" + "<id><hex>" through, a token cut into pieces by the digit rules.
    for (let i = 0; i < 200; i++) {
      const m = mk();
      for (const t of [m, `ya29.${m}`, `${m}@example.com`, `id=${m}`, `"${m}"`, `Customer 2795163852 token ya29.${m}, list 9876543210`]) {
        const out = maskPlatformText(t) ?? "";
        expect(out.includes(m)).toBe(false);
        expect(/mk[0-9a-f]/.test(out)).toBe(false);
      }
    }
  });
});
