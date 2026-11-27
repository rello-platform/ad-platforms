/**
 * PLATFORM AUDIT 163 round 3 on ad-platforms #2 (Platform KA prompt 2183).
 *
 * GD-3571: `fieldViolations[].reason` and `errorInfo.reason` were kept whenever they had the UPPER_SNAKE shape, so a 24-to-64
 *          character upper-snake run that is not a Google name came back whole. Now a reason is kept only when it is
 *          UPPER_SNAKE AND (shorter than 24 characters OR exactly a name in src/google/known-names.ts): the rule the text has.
 *          Anything else reads `<token>` (the key stays, so a reader sees a reason existed).
 * GD-3572: `errorInfo.domain` was kept whenever it looked like a host name, so a 32-letter run with no dot came back whole. Now a
 *          domain is kept only when it is exactly a listed Google error domain (src/google/known-domains.ts); anything else
 *          reads `<unrecognized_domain>`.
 *
 * Every fixture is built deterministically, as the auditor built theirs; every case runs through classifyGoogleResponse.
 */
import { describe, expect, it } from "vitest";
import { classifyGoogleResponse } from "../src/google/client.js";

/** The auditor's upper-snake run: three 9-letter words joined by underscores = 27 letters, 29 characters. */
const WORDS = ["QWERTYUIO", "ASDFGHJKL", "ZXCVBNMQW"];
const SNAKE27 = WORDS.join("_");
/** The auditor's domain: 32 lower-case letters, no dot. */
const DOMAIN32 = "qwertyuiopasdfghjklzxcvbnmqwerty";

/** Every 3-character slice of `secret` that is not plain punctuation. */
const fragments = (secret: string) => {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= secret.length; i++) {
    const f = secret.slice(i, i + 3);
    if (/[A-Za-z0-9]{2}/.test(f)) out.add(f);
  }
  return [...out];
};
const leaked = (text: string | undefined, secret: string) => fragments(secret).filter((f) => (text ?? "").includes(f));

type Detail = { fieldViolations?: Array<{ field?: string; reason?: string }>; errorInfo?: { reason?: string; domain?: string } };
/** A Google refusal through the real classifier, with the given reason in BOTH reason places and the given domain. */
const refused = (reason: unknown, domain: unknown): Detail => {
  const o = classifyGoogleResponse(
    {
      kind: "response",
      status: 400,
      text: JSON.stringify({
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: "bad",
          details: [
            { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "audience_members", reason, description: "bad" }] },
            { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain },
          ],
        },
      }),
    } as never,
    new Date("2026-11-27T00:00:00Z"),
  );
  return (o as { detail?: Detail }).detail ?? {};
};

describe("fixtures are what the audit built", () => {
  it("27 upper-case letters in three words; 32 lower-case letters with no dot", () => {
    expect(SNAKE27.replace(/_/g, "")).toMatch(/^[A-Z]{27}$/);
    expect(SNAKE27).toMatch(/^[A-Z][A-Z0-9_]{0,63}$/);
    expect(DOMAIN32).toMatch(/^[a-z]{32}$/);
  });
});

describe("GD-3571: a reason is kept only when it is a short UPPER_SNAKE word or a listed name", () => {
  it("the auditor's 27-letter upper-snake run is <token> in BOTH reason places and leaves no fragment", () => {
    const d = refused(SNAKE27, "googleapis.com");
    expect(d.fieldViolations?.[0]?.reason).toBe("<token>");
    expect(d.errorInfo?.reason).toBe("<token>");
    expect(leaked(d.fieldViolations?.[0]?.reason, SNAKE27)).toEqual([]);
    expect(leaked(d.errorInfo?.reason, SNAKE27)).toEqual([]);
  });

  it("an unlisted upper-snake run of 24 and of 64 characters is <token>; 23 characters stays readable", () => {
    const at = (n: number) => "ABCDEFGH_".repeat(10).slice(0, n).replace(/_$/, "Z");
    expect(at(23)).toHaveLength(23);
    expect(refused(at(23), "googleapis.com").errorInfo?.reason).toBe(at(23));
    expect(refused(at(24), "googleapis.com").errorInfo?.reason).toBe("<token>");
    expect(refused(at(24), "googleapis.com").fieldViolations?.[0]?.reason).toBe("<token>");
    expect(at(64)).toHaveLength(64);
    expect(refused(at(64), "googleapis.com").errorInfo?.reason).toBe("<token>");
  });

  it("real Google reasons stay readable: a short one, a listed ErrorReason and a listed ProcessingErrorReason (24+)", () => {
    for (const r of ["INVALID_ARGUMENT", "RATE_LIMIT_EXCEEDED", "INVALID_CONVERSION_ACTION_ID", "USER_LIST_TYPE_NOT_SUPPORTED_FOR_ACCOUNT", "PROCESSING_ERROR_REASON_INVALID_GCLID"]) {
      const d = refused(r, "googleapis.com");
      expect(d.fieldViolations?.[0]?.reason).toBe(r);
      expect(d.errorInfo?.reason).toBe(r);
    }
  });

  it("a listed name with a character added or cut off is not the listed name: <token>", () => {
    for (const r of ["INVALID_CONVERSION_ACTION_IDS", "INVALID_CONVERSION_ACTION_I", "INVALID_CONVERSION_ACTION_ID_", "XINVALID_CONVERSION_ACTION_ID"]) {
      expect(refused(r, "googleapis.com").errorInfo?.reason).toBe("<token>");
    }
  });

  it("a reason that is not UPPER_SNAKE text, or not text, is left out as before (never kept)", () => {
    for (const r of ["lower_snake_reason", "Mixed_Case", "has space", "", 5, null, { a: 1 }]) {
      const d = refused(r, "googleapis.com");
      expect(d.fieldViolations?.[0]?.reason).toBeUndefined();
      expect(d.errorInfo?.reason).toBeUndefined();
    }
  });
});

describe("GD-3572: a domain is kept only when it is a listed Google error domain", () => {
  it("the auditor's 32-letter domain with no dot is <unrecognized_domain> and leaves no fragment", () => {
    const d = refused("INVALID_ARGUMENT", DOMAIN32);
    expect(d.errorInfo?.domain).toBe("<unrecognized_domain>");
    expect(leaked(d.errorInfo?.domain, DOMAIN32)).toEqual([]);
  });

  it("listed domains stay readable", () => {
    for (const dom of ["googleapis.com", "datamanager.googleapis.com"]) expect(refused("INVALID_ARGUMENT", dom).errorInfo?.domain).toBe(dom);
  });

  it("anything else that merely looks like a host is <unrecognized_domain>", () => {
    for (const dom of [
      "datamanager.googleapis.com.example.test",
      "xdatamanager.googleapis.com",
      "googleapis.com.",
      "DATAMANAGER.GOOGLEAPIS.COM",
      "a1b2c3d4e5f6g7h8.example.com",
      "pubsub.googleapis.com",
      "x",
    ]) {
      expect(refused("INVALID_ARGUMENT", dom).errorInfo?.domain).toBe("<unrecognized_domain>");
    }
  });

  it("a domain that is absent, blank or not text is left out (the reason alone still gives an errorInfo)", () => {
    for (const dom of [undefined, "", null, 5, { a: 1 }]) {
      const d = refused("INVALID_ARGUMENT", dom);
      expect(d.errorInfo).toEqual({ reason: "INVALID_ARGUMENT" });
    }
  });
});
