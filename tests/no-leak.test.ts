/**
 * GD-2954 (audit 136): no console line and no returned field may carry text from a caller's callback
 * (the Google access-token source) or from a platform's error body. Logs carry a fixed code, and at
 * most the thrown value's built-in constructor name; outcome reasons carry fixed codes only.
 *
 * Every marker is generated in memory and is never printed: assertions are booleans
 * (`includes(marker)` → false), so a failing run shows "expected true to be false", not the marker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { format } from "node:util";
import { startFakeAdServer, type FakeAdServer } from "../src/fake/index.js";
import {
  buildGoogleConversionRequest,
  buildMetaConversionRequest,
  conversionOutcomeFromStatus,
  createAdPlatformClient,
  createGoogleClient,
  createMetaClient,
  freezeBatch,
  hashMember,
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

const newMarker = () => `mk${randomBytes(16).toString("hex")}`;

const METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;
function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spies = METHODS.map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    }),
  );
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}

const anyHas = (lines: string[], marker: string) => lines.some((l) => l.includes(marker));
const fieldHas = (v: unknown, marker: string) => JSON.stringify(v ?? null).includes(marker);
/** Deep equality as a boolean, so a failure never prints a value that might hold a marker. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function googleBatch(id: string) {
  const req = buildGoogleConversionRequest(
    { apiBase: fake.googleBase, operatingAccountId: "1234567890" },
    { conversionActionId: "action-leak", events: [{ transactionId: `rello:signup:${id}`, eventTime: new Date("2026-11-22T19:59:00Z"), email: "owner@example.com" }] },
  );
  return freezeBatch({ id, ...req });
}

describe("GD-2954: a token source's thrown text never reaches a console line or a returned field", () => {
  const throwers: Array<[string, (marker: string) => () => Promise<string>, string]> = [
    ["an Error", (mk) => async () => { throw new Error(`token service said: ya29.${mk} (key ${mk})`); }, "Error"],
    ["a string", (mk) => async () => { throw `ya29.${mk}`; }, "string"],
    ["an Error subclass whose class name is the marker", (mk) => {
      const Named = { [mk]: class extends Error {} }[mk]!;
      return async () => { throw new Named(`leak ${mk}`); };
    }, "Error subclass"],
  ];

  it.each(throwers)("the token source throws %s: four operations, 0 requests, a fixed log line, no marker anywhere", async (_label, make, kind) => {
    const mk = newMarker();
    const client = createGoogleClient(
      { getAccessToken: make(mk), apiBase: fake.googleBase, operatingAccountId: "1234567890", userListIds: { rello_prospects: "g-leak-list" } },
      { timeoutMs: 400, sleep: noSleep, statusPollMs: 0, statusMaxReads: 1 },
    );
    const members = [hashMember("GOOGLE", { email: "a@example.com" })!];
    const before = fake.requests.length;
    const cap = captureConsole();
    let outs: unknown[];
    try {
      outs = [
        await client.sendConversionBatch(HOUSE, googleBatch(`leak-${kind}`)),
        await client.replaceAudience(HOUSE, "rello_prospects", members, []),
        await client.removeFromAudience(HOUSE, "rello_prospects", members),
        await client.requestStatusDetail(HOUSE, "fake-request-1"),
      ];
    } finally {
      cap.restore();
    }
    expect(anyHas(cap.lines, mk)).toBe(false);
    expect(fieldHas(outs, mk)).toBe(false);
    expect(fake.requests.length).toBe(before);
    expect(outs.slice(0, 3)).toEqual([0, 1, 2].map(() => ({ status: "retryable", reason: "google_token_unavailable" })));
    expect(outs[3]).toEqual({ status: "UNREADABLE", errorReasons: [] });
    expect(cap.lines.length).toBe(4);
    const expected = `[ad-platforms/google] access token unavailable (google_token_unavailable) thrown=${kind}`;
    expect(cap.lines.every((l) => l === expected)).toBe(true);
  });
});

describe("GD-2954: platform error-body text never reaches an outcome reason", () => {
  const googleClient = () =>
    createGoogleClient({ getAccessToken: async () => "g-leak-token", apiBase: fake.googleBase, operatingAccountId: "1234567890" }, { timeoutMs: 400, sleep: noSleep });

  it("a Google error whose status is not a canonical code is reason google_http_<status>, with no body text", async () => {
    for (const [i, status] of [500, 400].entries()) {
      const mk = newMarker();
      for (const bodyStatus of [`not a code ${mk}`, `LEAK_${mk.toUpperCase()}`]) {
        fake.next("google.events", { kind: "status", status, body: { error: { code: status, status: bodyStatus, message: mk } } });
        const cap = captureConsole();
        let out: unknown;
        try {
          out = await googleClient().sendConversionBatch(HOUSE, googleBatch(`leak-status-${i}-${bodyStatus.length}`));
        } finally {
          cap.restore();
        }
        expect(fieldHas(out, mk)).toBe(false);
        expect(fieldHas(out, mk.toUpperCase())).toBe(false);
        expect(anyHas(cap.lines, mk)).toBe(false);
        expect(same(out, { status: "unknown", reason: `google_http_${status}` })).toBe(true);
      }
    }
  });

  it("a Google request-status errorCounts reason that is not an enum name is reported as UNRECOGNIZED_REASON", async () => {
    const mk = newMarker();
    fake.next("google.status", {
      kind: "status",
      status: 200,
      body: { requestStatusPerDestination: [{ requestStatus: "FAILED", errorInfo: { errorCounts: [{ recordCount: "1", reason: `bad ya29.${mk}` }, { recordCount: "1", reason: "PROCESSING_ERROR_REASON_INVALID_GCLID" }] } }] },
    });
    const detail = await googleClient().requestStatusDetail(HOUSE, "fake-request-x");
    expect(fieldHas(detail, mk)).toBe(false);
    expect(same(detail, { status: "FAILED", errorReasons: ["UNRECOGNIZED_REASON", "PROCESSING_ERROR_REASON_INVALID_GCLID"] })).toBe(true);
  });

  it("conversionOutcomeFromStatus carries only enum-shaped reasons", () => {
    const mk = newMarker();
    for (const status of ["FAILED", "PARTIAL_SUCCESS"] as const) {
      const out = conversionOutcomeFromStatus({ status, errorReasons: [`free text ${mk}`, `PROCESSING_ERROR_REASON_${mk}`, "PROCESSING_ERROR_REASON_INVALID_GCLID"] });
      expect(fieldHas(out, mk)).toBe(false);
      expect(/:UNRECOGNIZED_REASON,UNRECOGNIZED_REASON,PROCESSING_ERROR_REASON_INVALID_GCLID$/.test("reason" in out ? out.reason : "")).toBe(true);
    }
  });

  it("a transport failure's reason is a code, not the socket error's message", async () => {
    const dead = await deadBase();
    const metaReq = buildMetaConversionRequest({ apiBase: dead, apiVersion: "v21.0", datasetId: "ds-leak" }, [
      { eventName: "Lead", eventTime: new Date("2026-11-22T20:00:00Z"), eventId: "rello:lead:leak", email: "p@example.com" },
    ]);
    const meta = createMetaClient({ accessToken: "meta-leak-token", apiBase: dead }, { timeoutMs: 400 });
    expect(await meta.sendConversionBatch(HOUSE, freezeBatch({ id: "leak-dead", ...metaReq }))).toEqual({ status: "retryable", reason: "meta_before_write:ECONNREFUSED" });

    fake.next("meta.events", { kind: "drop" });
    const dropReq = buildMetaConversionRequest({ apiBase: fake.metaBase, apiVersion: "v21.0", datasetId: "ds-leak-drop" }, [
      { eventName: "Lead", eventTime: new Date("2026-11-22T20:00:00Z"), eventId: "rello:lead:leak-drop", email: "p@example.com" },
    ]);
    const dropped = await createMetaClient({ accessToken: "meta-leak-token", apiBase: fake.metaBase }, { timeoutMs: 400 }).sendConversionBatch(HOUSE, freezeBatch({ id: "leak-drop", ...dropReq }));
    expect(dropped.status).toBe("unknown");
    expect("reason" in dropped ? dropped.reason : "").toMatch(/^meta_after_connect:[A-Z][A-Z0-9_]*$/);
  });
});

describe("GD-2954: an unusable credentials JSON logs a fixed code", () => {
  it.each([
    ["not JSON", (mk: string) => `{"client_email":"${mk}`, "google_credentials_not_json"],
    ["no client_email", (mk: string) => JSON.stringify({ private_key: `-----BEGIN PRIVATE KEY-----${mk}` }), "google_credentials_no_client_email"],
    ["no private_key", (mk: string) => JSON.stringify({ client_email: `${mk}@example.iam` }), "google_credentials_no_private_key"],
  ])("%s → not_connected, 0 requests, one fixed line", async (_label, make, code) => {
    const mk = newMarker();
    const before = fake.requests.length;
    const cap = captureConsole();
    let out: unknown;
    try {
      const c = createAdPlatformClient("GOOGLE", { ADS_GOOGLE_CREDENTIALS_JSON: make(mk), ADS_HOUSE_GOOGLE_CUSTOMER_ID: "1234567890", ADS_GOOGLE_DATAMANAGER_API_BASE: fake.googleBase });
      out = await c.sendConversionBatch(HOUSE, googleBatch(`leak-cred-${code}`));
    } finally {
      cap.restore();
    }
    expect(out).toEqual({ status: "not_connected" });
    expect(fake.requests.length).toBe(before);
    expect(anyHas(cap.lines, mk)).toBe(false);
    expect(same(cap.lines, [`[ad-platforms] ADS_GOOGLE_CREDENTIALS_JSON unusable, Google is not connected (${code})`])).toBe(true);
  });
});
