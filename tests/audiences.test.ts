/**
 * The §6.2 Rev 2 fake tests (S12a), red first, against a fake that starts holding a remote member set.
 * Each platform's four operations (conversions are in the conversion test files) are cells:
 * replace, remove, clear.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFakeAdServer, metaMemberKey, googleMemberKey, type FakeAdServer } from "../src/fake/index.js";
import { createMetaClient, createGoogleClient, hashMember, type HashedMember, type Platform } from "../src/index.js";
import { noSleep } from "./helpers.js";

const HOUSE = { tenantId: "tenant_rello_growth" };
let fake: FakeAdServer;
beforeAll(async () => {
  fake = await startFakeAdServer({ metaReplaceInProgressReads: 1 });
});
afterAll(async () => {
  await fake.close();
});

const people = { A: "a.person@gmail.com", B: "b@example.com", C: "c@example.com", D: "d@example.com" } as const;
type P = keyof typeof people;
const m = (platform: Platform, ...ps: P[]): HashedMember[] => ps.map((p) => hashMember(platform, { email: people[p] })!);

let seq = 0;
interface Harness {
  platform: Platform;
  list: string;
  remoteId: string;
  seed(...ps: P[]): void;
  remote(): string[];
  keys(...ps: P[]): string[];
  client(opts?: { batchSize?: number }): ReturnType<typeof createMetaClient>;
}

function harness(platform: Platform): Harness {
  const remoteId = `${platform.toLowerCase()}-list-${++seq}`;
  const list = "rello_prospects";
  const key = platform === "META" ? metaMemberKey : googleMemberKey;
  return {
    platform,
    list,
    remoteId,
    seed: (...ps) => (platform === "META" ? fake.meta.seed(remoteId, m("META", ...ps)) : fake.google.seed(remoteId, m("GOOGLE", ...ps))),
    remote: () => (platform === "META" ? fake.meta.members(remoteId) : fake.google.members(remoteId)),
    keys: (...ps) => m(platform, ...ps).map(key).sort(),
    client: (opts = {}) =>
      platform === "META"
        ? createMetaClient(
            { accessToken: "meta-aud-token", apiBase: fake.metaBase, audienceIds: { [list]: remoteId } },
            { timeoutMs: 1000, batchSize: opts.batchSize, statusPollMs: 0, statusMaxReads: 5, sleep: noSleep },
          )
        : createGoogleClient(
            { getAccessToken: async () => "g-aud-token", apiBase: fake.googleBase, operatingAccountId: "1234567890", userListIds: { [list]: remoteId } },
            { timeoutMs: 1000, batchSize: opts.batchSize, statusPollMs: 0, statusMaxReads: 5, sleep: noSleep },
          ),
  };
}

describe.each(["META", "GOOGLE"] as const)("%s audiences", (platform) => {
  it(`[cell ${platform}.replace] remote {A,B,C}, replace with {B,D} → the fake holds {B,D}`, async () => {
    const h = harness(platform);
    h.seed("A", "B", "C");
    const out = await h.client().replaceAudience(HOUSE, h.list, m(platform, "B", "D"), m(platform, "A", "B", "C"));
    expect(out.status).toBe("accepted");
    expect(h.remote()).toEqual(h.keys("B", "D"));
  });

  it(`[cell ${platform}.clear] remote {A,B}, replace with {} → the fake is empty`, async () => {
    const h = harness(platform);
    h.seed("A", "B");
    const out = await h.client().replaceAudience(HOUSE, h.list, [], m(platform, "A", "B"));
    expect(out.status).toBe("accepted");
    expect(h.remote()).toEqual([]);
    if (platform === "META") {
      // Never an empty usersreplace: its behaviour is undocumented. DELETE of the possibly-applied set.
      expect(fake.requestsOn("meta.usersreplace").filter((r) => r.path.includes(h.remoteId))).toHaveLength(0);
      expect(fake.requestsOn("meta.users.delete").filter((r) => r.path.includes(h.remoteId)).length).toBeGreaterThan(0);
    } else {
      const ra = fake.requestsOn("google.removeAll").filter((r) => r.body.toString().includes(h.remoteId));
      expect(ra).toHaveLength(1);
      expect(JSON.parse(ra[0]!.body.toString())).not.toHaveProperty("removeAsOfTime");
    }
  });

  it(`[cell ${platform}.remove] remove {B} from {A,B,C} → {A,C}`, async () => {
    const h = harness(platform);
    h.seed("A", "B", "C");
    const out = await h.client().removeFromAudience(HOUSE, h.list, m(platform, "B"));
    expect(out.status).toBe("accepted");
    expect(h.remote()).toEqual(h.keys("A", "C"));
  });

  it("removing a member the fake doesn't hold succeeds and changes nothing", async () => {
    const h = harness(platform);
    h.seed("A");
    const out = await h.client().removeFromAudience(HOUSE, h.list, m(platform, "D"));
    expect(out.status).toBe("accepted");
    expect(h.remote()).toEqual(h.keys("A"));
  });

  it("a list with no configured remote id is not_connected with 0 requests", async () => {
    const h = harness(platform);
    const before = fake.requests.length;
    const out = await h.client().replaceAudience(HOUSE, "rello_customers", m(platform, "A"), []);
    expect(out).toEqual({ status: "not_connected" });
    expect(fake.requests.length).toBe(before);
  });

  it("an empty target with an empty possibly-applied set still clears (never assumes the remote is empty)", async () => {
    const h = harness(platform);
    h.seed("A");
    const out = await h.client().replaceAudience(HOUSE, h.list, [], []);
    if (platform === "GOOGLE") {
      expect(out.status).toBe("accepted");
      expect(h.remote()).toEqual([]);
    } else {
      // Meta can delete only what it can name; an empty set names nothing and the call is a no-op.
      expect(out.status).toBe("accepted");
      expect(fake.requestsOn("meta.users.delete").filter((r) => r.path.includes(h.remoteId))).toHaveLength(0);
    }
  });
});

describe("Meta replace sessions", () => {
  it("batches ≤ batchSize with batch_seq 1…n and last_batch_flag on the last, one session id", async () => {
    const h = harness("META");
    const out = await h.client({ batchSize: 2 }).replaceAudience(HOUSE, h.list, m("META", "A", "B", "C"), []);
    expect(out.status).toBe("accepted");
    const sent = fake.requestsOn("meta.usersreplace").filter((r) => r.path.includes(h.remoteId)).map((r) => JSON.parse(r.body.toString()));
    expect(sent.map((b) => b.session.batch_seq)).toEqual([1, 2]);
    expect(sent.map((b) => b.session.last_batch_flag)).toEqual([false, true]);
    expect(new Set(sent.map((b) => b.session.session_id)).size).toBe(1);
    expect(sent[0].session.estimated_num_total).toBe(3);
    expect(sent.map((b) => b.payload.data.length)).toEqual([2, 1]);
    expect(h.remote()).toEqual(h.keys("A", "B", "C"));
  });

  it("a session timeout after batch 1 of 2 is PARTIAL with batch 1 applied; the next run converges", async () => {
    const h = harness("META");
    h.seed("D");
    fake.meta.timeoutReplaceAfterBatch(h.remoteId, 1);
    const first = await h.client({ batchSize: 2 }).replaceAudience(HOUSE, h.list, m("META", "A", "B", "C"), m("META", "D"));
    expect(first).toMatchObject({ status: "partial", done: 1, failed: 1 });
    expect(h.remote()).toEqual(h.keys("A", "B"));
    const second = await h.client({ batchSize: 2 }).replaceAudience(HOUSE, h.list, m("META", "A", "B", "C"), m("META", "A", "B", "D"));
    expect(second.status).toBe("accepted");
    expect(h.remote()).toEqual(h.keys("A", "B", "C"));
  });

  it("replace_error after the last batch is PARTIAL", async () => {
    const h = harness("META");
    h.seed("A");
    fake.meta.failNextReplace(h.remoteId);
    const out = await h.client().replaceAudience(HOUSE, h.list, m("META", "B"), m("META", "A"));
    expect(out.status).toBe("partial");
  });

  it("a remove of more than batchSize members is split into DELETE batches", async () => {
    const h = harness("META");
    h.seed("A", "B", "C");
    const out = await h.client({ batchSize: 2 }).removeFromAudience(HOUSE, h.list, m("META", "A", "B", "C"));
    expect(out.status).toBe("accepted");
    expect(fake.requestsOn("meta.users.delete").filter((r) => r.path.includes(h.remoteId))).toHaveLength(2);
    expect(h.remote()).toEqual([]);
  });

  it("a failed DELETE batch is PARTIAL and names how many batches failed", async () => {
    const h = harness("META");
    h.seed("A", "B", "C");
    fake.next("meta.users.delete", { kind: "status", status: 500, body: {} });
    const out = await h.client({ batchSize: 2 }).removeFromAudience(HOUSE, h.list, m("META", "A", "B", "C"));
    expect(out).toMatchObject({ status: "partial", done: 1, failed: 1 });
  });
});

describe("Google replace: record T → ingest → status SUCCESS → removeAll(removeAsOfTime = T)", () => {
  it("sends removeAll with the T recorded before the ingest", async () => {
    const h = harness("GOOGLE");
    h.seed("A");
    const out = await h.client().replaceAudience(HOUSE, h.list, m("GOOGLE", "B"), m("GOOGLE", "A"));
    expect(out.status).toBe("accepted");
    const ingest = fake.requestsOn("google.ingest").filter((r) => r.body.toString().includes(h.remoteId));
    const ra = fake.requestsOn("google.removeAll").filter((r) => r.body.toString().includes(h.remoteId));
    expect(ingest).toHaveLength(1);
    expect(ra).toHaveLength(1);
    expect(fake.requests.indexOf(ingest[0]!)).toBeLessThan(fake.requests.indexOf(ra[0]!));
    const t = JSON.parse(ra[0]!.body.toString()).removeAsOfTime as string;
    expect(Number.isNaN(Date.parse(t))).toBe(false);
    const body = JSON.parse(ingest[0]!.body.toString());
    expect(body.termsOfService).toEqual({ customerMatchTermsOfServiceStatus: "ACCEPTED" });
    expect(body.encoding).toBe("HEX");
    expect(h.remote()).toEqual(h.keys("B"));
  });

  it("ingest FAILED → removeAll is never sent and the remote set is unchanged", async () => {
    const h = harness("GOOGLE");
    h.seed("A", "B", "C");
    fake.google.scriptNextRequest(["PROCESSING", "FAILED"]);
    const out = await h.client().replaceAudience(HOUSE, h.list, m("GOOGLE", "B", "D"), m("GOOGLE", "A", "B", "C"));
    expect(out.status).toBe("partial");
    expect(fake.requestsOn("google.removeAll").filter((r) => r.body.toString().includes(h.remoteId))).toHaveLength(0);
    expect(h.remote()).toEqual(h.keys("A", "B", "C"));
  });

  it("ingest still PROCESSING after the last status read → UNKNOWN, and no removeAll", async () => {
    const h = harness("GOOGLE");
    h.seed("A");
    fake.google.scriptNextRequest(["PROCESSING"]);
    const out = await h.client().replaceAudience(HOUSE, h.list, m("GOOGLE", "B"), m("GOOGLE", "A"));
    expect(out.status).toBe("unknown");
    expect(fake.requestsOn("google.removeAll").filter((r) => r.body.toString().includes(h.remoteId))).toHaveLength(0);
  });

  it("splits ingest into requests of ≤ batchSize members", async () => {
    const h = harness("GOOGLE");
    const out = await h.client({ batchSize: 2 }).replaceAudience(HOUSE, h.list, m("GOOGLE", "A", "B", "C"), []);
    expect(out.status).toBe("accepted");
    expect(fake.requestsOn("google.ingest").filter((r) => r.body.toString().includes(h.remoteId))).toHaveLength(2);
    expect(h.remote()).toEqual(h.keys("A", "B", "C"));
  });
});
