/**
 * Google Data Manager conversions against the fake (§4.5 Rev 4 item 2's table).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { startFakeAdServer, type FakeAdServer } from "../src/fake/index.js";
import {
  buildGoogleConversionRequest,
  createGoogleClient,
  conversionOutcomeFromStatus,
  freezeBatch,
  nextMidnightPacific,
  type FrozenBatch,
} from "../src/index.js";
import { deadBase, noSleep } from "./helpers.js";

const HOUSE = { tenantId: "tenant_rello_growth" };
let fake: FakeAdServer;
beforeAll(async () => {
  fake = await startFakeAdServer();
});
afterAll(async () => {
  await fake.close();
});

const NOW = new Date("2026-11-22T20:00:00Z"); // 12:00 PST

function client(base?: string) {
  return createGoogleClient(
    { getAccessToken: async () => "google-test-access", apiBase: base ?? fake.googleBase, operatingAccountId: "1234567890" },
    { timeoutMs: 400, now: () => NOW, sleep: noSleep },
  );
}

function batch(id: string, action: string, tx = `rello:signup:${id}`, base = fake.googleBase): FrozenBatch {
  const req = buildGoogleConversionRequest(
    { apiBase: base, operatingAccountId: "1234567890", loginAccountId: "9876543210" },
    {
      conversionActionId: action,
      events: [
        {
          transactionId: tx,
          eventTime: new Date("2026-11-22T19:59:00.123Z"),
          email: "Owner.Name@Gmail.com",
          phone: "(801) 555-0142",
          gclid: "Cj0KCQ-test",
          value: { amount: 99, currency: "USD" },
        },
      ],
    },
  );
  return freezeBatch({ id, ...req });
}

const quota = (limit?: string) => ({
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "quota",
    details: limit
      ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED", metadata: { quota_limit: limit } }]
      : [],
  },
});

describe("Google conversions", () => {
  it("[cell GOOGLE.conversions] accepted with a requestId; the body is byte-identical across attempts", async () => {
    const b = batch("g1", "action-1");
    const a1 = await client().sendConversionBatch(HOUSE, b);
    const a2 = await client().sendConversionBatch(HOUSE, b);
    expect(a1).toMatchObject({ status: "accepted" });
    expect(a1.status === "accepted" && a1.requestId).toBeTruthy();
    const reqs = fake.requestsOn("google.events").slice(-2);
    expect(reqs.map((r) => createHash("sha256").update(r.body).digest("hex"))).toEqual([b.bodySha256, b.bodySha256]);
    expect(reqs[0]!.headers.authorization).toBe("Bearer google-test-access");
    expect(reqs[0]!.path).toBe("/google/v1/events:ingest");
    // Google keeps the first transactionId; the repeat is reported as a duplicate.
    expect(fake.google.events("action-1")).toHaveLength(1);
    const st = a2.status === "accepted" ? await client().requestStatusDetail(HOUSE, a2.requestId!) : null;
    expect(st && conversionOutcomeFromStatus(st)).toEqual({ status: "duplicate" });
  });

  it("the event is Data Manager's shape: hashed userData (Gmail-normalized), adIdentifiers, RFC 3339 time", () => {
    const body = JSON.parse(new TextDecoder().decode(batch("g2", "action-2").body)) as Record<string, any>;
    expect(body.destinations).toEqual([
      {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
        loginAccount: { accountType: "GOOGLE_ADS", accountId: "9876543210" },
        productDestinationId: "action-2",
      },
    ]);
    expect(body.encoding).toBe("HEX");
    expect(body.consent).toEqual({ adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" });
    const ev = body.events[0];
    expect(ev.transactionId).toBe("rello:signup:g2");
    expect(ev.eventTimestamp).toBe("2026-11-22T19:59:00.123Z");
    expect(ev.eventSource).toBe("WEB");
    expect(ev.adIdentifiers).toEqual({ gclid: "Cj0KCQ-test" });
    expect(ev.conversionValue).toBe(99);
    expect(ev.currency).toBe("USD");
    expect(ev.userData.userIdentifiers).toEqual([
      { emailAddress: createHash("sha256").update("ownername@gmail.com").digest("hex") },
      { phoneNumber: createHash("sha256").update("+18015550142").digest("hex") },
    ]);
  });

  it("transient server codes are RETRYABLE (safe by transactionId)", async () => {
    for (const status of ["UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL", "UNKNOWN", "ABORTED"]) {
      fake.next("google.events", { kind: "status", status: 503, body: { error: { code: 503, status, message: "x" } } });
      const out = await client().sendConversionBatch(HOUSE, batch(`g-${status}`, "action-t"));
      expect(out).toMatchObject({ status: "retryable" });
      expect(out.status === "retryable" && out.notBefore).toBeFalsy();
    }
  });

  it("per-minute RESOURCE_EXHAUSTED is RETRYABLE with no notBefore (backoff)", async () => {
    fake.next("google.events", { kind: "status", status: 429, body: quota("IngestionMutateRequestsPerMinutePerProject") });
    const out = await client().sendConversionBatch(HOUSE, batch("g-min", "action-q"));
    expect(out).toEqual({ status: "retryable", reason: "quota_per_minute", detail: { httpStatus: 429, status: "RESOURCE_EXHAUSTED", message: "quota", errorInfo: { reason: "RATE_LIMIT_EXCEEDED" } } });
  });

  it("daily RESOURCE_EXHAUSTED is RETRYABLE with notBefore = next 00:00 America/Los_Angeles", async () => {
    fake.next("google.events", { kind: "status", status: 429, body: quota("IngestionMutateRequestsPerDayPerProject") });
    const out = await client().sendConversionBatch(HOUSE, batch("g-day", "action-q"));
    expect(out).toEqual({ status: "retryable", reason: "quota_daily", notBefore: "2026-11-23T08:00:00.000Z", detail: { httpStatus: 429, status: "RESOURCE_EXHAUSTED", message: "quota", errorInfo: { reason: "RATE_LIMIT_EXCEEDED" } } });
  });

  it("RESOURCE_EXHAUSTED without ErrorInfo is treated as daily, reason quota_unclassified", async () => {
    fake.next("google.events", { kind: "status", status: 429, body: quota() });
    const out = await client().sendConversionBatch(HOUSE, batch("g-unc", "action-q"));
    expect(out).toEqual({ status: "retryable", reason: "quota_unclassified", notBefore: "2026-11-23T08:00:00.000Z", detail: { httpStatus: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } });
  });

  it("nextMidnightPacific handles daylight time", () => {
    expect(nextMidnightPacific(new Date("2026-07-01T20:00:00Z"))).toBe("2026-07-02T07:00:00.000Z");
    expect(nextMidnightPacific(new Date("2026-11-23T07:59:59Z"))).toBe("2026-11-23T08:00:00.000Z");
    expect(nextMidnightPacific(new Date("2026-11-23T08:00:00Z"))).toBe("2026-11-24T08:00:00.000Z");
  });

  it("final codes are REJECTED", async () => {
    for (const status of ["INVALID_ARGUMENT", "PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND", "FAILED_PRECONDITION"]) {
      fake.next("google.events", { kind: "status", status: 400, body: { error: { code: 400, status, message: "x" } } });
      expect((await client().sendConversionBatch(HOUSE, batch(`g-r-${status}`, "action-r"))).status).toBe("rejected");
    }
  });

  it("a timeout with no answer is UNKNOWN, never rejected or accepted", async () => {
    fake.next("google.events", { kind: "hang" });
    expect((await client().sendConversionBatch(HOUSE, batch("g-hang", "action-h"))).status).toBe("unknown");
  });

  it("an unparseable 200 is UNKNOWN", async () => {
    fake.next("google.events", { kind: "status", status: 200, body: "not json at all" });
    expect((await client().sendConversionBatch(HOUSE, batch("g-junk", "action-j"))).status).toBe("unknown");
  });

  it("a transport failure before writing is RETRYABLE; a token that can't be minted is RETRYABLE with 0 ingest requests", async () => {
    const dead = await deadBase();
    expect((await client(dead).sendConversionBatch(HOUSE, batch("g-dead", "action-d", "tx-d", dead))).status).toBe("retryable");
    const before = fake.requestsOn("google.events").length;
    const noToken = createGoogleClient(
      { getAccessToken: async () => { throw new Error("token endpoint down"); }, apiBase: fake.googleBase, operatingAccountId: "1" },
      { timeoutMs: 400, sleep: noSleep },
    );
    expect((await noToken.sendConversionBatch(HOUSE, batch("g-tok", "action-d"))).status).toBe("retryable");
    expect(fake.requestsOn("google.events").length).toBe(before);
  });

  it("requestStatus aggregates the destinations' statuses, and an unreadable answer is UNREADABLE", async () => {
    fake.google.scriptNextRequest(["PROCESSING", "SUCCESS"]);
    const out = await client().sendConversionBatch(HOUSE, batch("g-st", "action-s"));
    const id = out.status === "accepted" ? out.requestId! : "";
    expect(await client().requestStatus!(HOUSE, id)).toBe("PROCESSING");
    expect(await client().requestStatus!(HOUSE, id)).toBe("SUCCESS");
    expect(await client().requestStatus!(HOUSE, "no-such-request")).toBe("UNREADABLE");
    fake.next("google.status", { kind: "status", status: 500, body: {} });
    expect(await client().requestStatus!(HOUSE, id)).toBe("UNREADABLE");
  });
});
