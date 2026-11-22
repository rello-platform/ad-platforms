/**
 * Meta Conversions API client against the fake (§4.5 Rev 3 item 3, Meta column).
 * Meta: only a transport failure before the request was written is retryable; any 5xx, 429,
 * timeout or reset after writing, or 2xx without events_received is UNKNOWN and never resent.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { startFakeAdServer, type FakeAdServer } from "../src/fake/index.js";
import { buildMetaConversionRequest, createMetaClient, freezeBatch, type FrozenBatch } from "../src/index.js";
import { deadBase } from "./helpers.js";

const HOUSE = { tenantId: "tenant_rello_growth" };
const TOKEN = "meta-test-token-xyz";
let fake: FakeAdServer;

beforeAll(async () => {
  fake = await startFakeAdServer();
});
afterAll(async () => {
  await fake.close();
});

function batch(id: string, datasetId: string, base = fake.metaBase): FrozenBatch {
  const req = buildMetaConversionRequest({ apiBase: base, apiVersion: "v21.0", datasetId }, [
    {
      eventName: "CompleteRegistration",
      eventTime: new Date("2026-11-22T20:00:00Z"),
      eventId: "rello:signup:tenant_abc",
      email: "Owner@Example.com",
      phone: "(801) 555-0142",
      externalId: { tenantId: HOUSE.tenantId, subjectId: "user_1" },
      fbc: "fb.1.1554763741205.AbCdEf",
      value: { amount: 99, currency: "USD" },
    },
  ]);
  return freezeBatch({ id, ...req });
}

const client = (base?: string) => createMetaClient({ accessToken: TOKEN, ...(base ? { apiBase: base } : {}) }, { timeoutMs: 400 });

describe("Meta conversions", () => {
  it("[cell META.conversions] accepted; the frozen body arrives byte for byte; the token is only in a header", async () => {
    const b = batch("b1", "ds-accept");
    const before = fake.requestsOn("meta.events").length;
    const out = await client().sendConversionBatch(HOUSE, b);
    expect(out.status).toBe("accepted");
    const reqs = fake.requestsOn("meta.events");
    expect(reqs.length).toBe(before + 1);
    const got = reqs[reqs.length - 1]!;
    expect(got.path).toBe("/meta/v21.0/ds-accept/events");
    expect(Buffer.compare(got.body, Buffer.from(b.body))).toBe(0);
    expect(createHash("sha256").update(got.body).digest("hex")).toBe(b.bodySha256);
    expect(got.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(got.body.toString()).not.toContain(TOKEN);
    expect(JSON.stringify(got.query)).not.toContain(TOKEN);
    expect(fake.meta.events("ds-accept")).toHaveLength(1);
  });

  it("the event carries hashed em/ph/external_id, unhashed fbc, and no raw identifier", () => {
    const text = new TextDecoder().decode(batch("b2", "ds").body);
    const ev = (JSON.parse(text) as { data: Array<Record<string, unknown>> }).data[0]!;
    const ud = ev.user_data as Record<string, unknown>;
    expect(ev.event_name).toBe("CompleteRegistration");
    expect(ev.event_time).toBe(Math.floor(Date.parse("2026-11-22T20:00:00Z") / 1000));
    expect(ev.event_id).toBe("rello:signup:tenant_abc");
    expect(ev.action_source).toBe("website");
    expect(ud.em).toEqual([createHash("sha256").update("owner@example.com").digest("hex")]);
    expect(ud.ph).toEqual([createHash("sha256").update("18015550142").digest("hex")]);
    expect(ud.external_id).toEqual([createHash("sha256").update("tenant_rello_growth:user_1").digest("hex")]);
    expect(ud.fbc).toBe("fb.1.1554763741205.AbCdEf");
    expect(ev.custom_data).toEqual({ value: 99, currency: "USD" });
    expect(text).not.toMatch(/owner@example\.com|555-0142|user_1/i);
  });

  it("a timeout with no answer is UNKNOWN, never rejected or accepted", async () => {
    fake.next("meta.events", { kind: "hang" });
    const out = await client().sendConversionBatch(HOUSE, batch("b3", "ds-hang"));
    expect(out.status).toBe("unknown");
  });

  it("applied but the response was lost is UNKNOWN; the fake kept the events", async () => {
    fake.next("meta.events", { kind: "drop" });
    const out = await client().sendConversionBatch(HOUSE, batch("b4", "ds-drop"));
    expect(out.status).toBe("unknown");
    expect(fake.meta.events("ds-drop")).toHaveLength(1);
  });

  it("429 and 503 are UNKNOWN, and the client sends once (no resend)", async () => {
    for (const status of [429, 503]) {
      const ds = `ds-${status}`;
      fake.next("meta.events", { kind: "status", status, body: { error: { code: 4, message: "busy" } } });
      const before = fake.requestsOn("meta.events").length;
      const out = await client().sendConversionBatch(HOUSE, batch(`b-${status}`, ds));
      expect(out.status).toBe("unknown");
      expect(fake.requestsOn("meta.events").length).toBe(before + 1);
    }
  });

  it("a 4xx with a parameter or token code (100, 190) is REJECTED", async () => {
    for (const code of [100, 190]) {
      fake.next("meta.events", { kind: "status", status: 400, body: { error: { code, message: "bad" } } });
      const out = await client().sendConversionBatch(HOUSE, batch(`b-r${code}`, "ds-rej"));
      expect(out).toMatchObject({ status: "rejected" });
    }
  });

  it("a 4xx with a code that is not a parameter/token/permission code is UNKNOWN", async () => {
    fake.next("meta.events", { kind: "status", status: 400, body: { error: { code: 1, message: "unknown error" } } });
    expect((await client().sendConversionBatch(HOUSE, batch("b-u1", "ds-u"))).status).toBe("unknown");
  });

  it("a 2xx without events_received is UNKNOWN", async () => {
    fake.next("meta.events", { kind: "status", status: 200, body: { messages: [] } });
    expect((await client().sendConversionBatch(HOUSE, batch("b5", "ds-noer"))).status).toBe("unknown");
  });

  it("a transport failure before the request was written is RETRYABLE", async () => {
    const dead = await deadBase();
    const out = await client(dead).sendConversionBatch(HOUSE, batch("b6", "ds-dead", dead));
    expect(out.status).toBe("retryable");
  });

  it("a batch whose body no longer matches its sha256 is REJECTED with 0 requests", async () => {
    const b = batch("b7", "ds-tamper");
    const before = fake.requests.length;
    const out = await client().sendConversionBatch(HOUSE, { ...b, body: new TextEncoder().encode("{}") });
    expect(out).toMatchObject({ status: "rejected" });
    expect(fake.requests.length).toBe(before);
  });
});
