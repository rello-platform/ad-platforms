/**
 * PLATFORM AUDIT 163 round 2 on ad-platforms #2 (Platform KA prompt 2159).
 *
 * GD-3508: the field check looked at each run of letters and digits alone, so a 40-character opaque field split by
 *          underscores into short pieces kept every piece under 16 and came back whole.
 * GD-3509: any run shaped like camelCase or snake_case was kept readable at any length, so an arbitrary all-letter
 *          value in that shape came back whole. Now a long run stays readable only when it is a NAME IN THE LIST
 *          (src/google/known-names.ts, each entry sourced); casing says nothing.
 *
 * Every fixture is built deterministically, as the auditor built theirs.
 */
import { describe, expect, it } from "vitest";
import { googleErrorDetail, maskFieldPath, maskPlatformText } from "../src/google/error-detail.js";
import { GOOGLE_KNOWN_NAMES } from "../src/google/known-names.js";
import { GOOGLE_PROCESSING_ERROR_REASONS } from "../src/google/processing-error-reasons.js";
import { classifyGoogleResponse } from "../src/google/client.js";

const CANONICAL = new Set(["INVALID_ARGUMENT", "NOT_FOUND", "PERMISSION_DENIED"]);

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

/** The auditor's split-by-underscore field: three alphanumeric pieces (13 + 13 + 12) joined by two underscores = 40 characters. */
const PIECES = ["a1b2c3d4e5f6g", "h7i8j9k0l1m2n", "o3p4q5r6s7t8"];
const SPLIT_FIELD = PIECES.join("_");
/** Letters-only split: three pieces under 16, 24+ letters in all. */
const SPLIT_LETTERS = ["qwertyuiopasd", "fghjklzxcvbnm", "poiuytrewq"].join("_");
/** Sparse capitals, all letters, 32 characters, 2 capitals: shaped like camelCase. */
const CAMEL_SHAPED = "qwertyuiopAsdfghjklZxcvbnmqwerty";
/** All letters, three words joined by underscores: shaped like snake_case. */
const SNAKE_SHAPED = "qwertyuiop_asdfghjkl_zxcvbnm_qwerty";
const UPPER_SNAKE_SHAPED = "QWERTYUIOP_ASDFGHJKL_ZXCVBNM";

/** A Google error response through the real classifier, the way a caller sees it. */
const refused = (message: string, field: string, description: string) =>
  classifyGoogleResponse(
    {
      kind: "response",
      status: 400,
      text: JSON.stringify({
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message,
          details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field, reason: "INVALID_USER_LIST_TYPE", description }] }],
        },
      }),
    } as never,
    new Date("2026-11-27T00:00:00Z"),
  );
const detailOf = (o: ReturnType<typeof refused>) => (o as { detail?: ReturnType<typeof googleErrorDetail> }).detail;

describe("fixtures are what the audit built", () => {
  it("the split field is 40 characters, each piece under 16, mixed letters and digits", () => {
    expect(SPLIT_FIELD).toHaveLength(40);
    for (const p of PIECES) {
      expect(p.length).toBeLessThan(16);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[A-Za-z]/);
    }
  });
  it("the camel-shaped value is 32 letters with two capitals; the snake-shaped ones are 24+ letters", () => {
    expect(CAMEL_SHAPED).toHaveLength(32);
    expect(CAMEL_SHAPED.replace(/[^A-Z]/g, "")).toHaveLength(2);
    expect(/^[A-Za-z]+$/.test(CAMEL_SHAPED)).toBe(true);
    expect(SNAKE_SHAPED.replace(/_/g, "")).toMatch(/^[a-z]{24,}$/);
    expect(UPPER_SNAKE_SHAPED.replace(/_/g, "")).toMatch(/^[A-Z]{24,}$/);
  });
});

describe("GD-3508: a field segment is judged whole, underscores ignored", () => {
  it("the 40-character split field gives <unrecognized_field> through classifyGoogleResponse", () => {
    const d = detailOf(refused("bad", SPLIT_FIELD, "bad"));
    expect(d?.fieldViolations?.[0]?.field).toBe("<unrecognized_field>");
    expect(leaked(d?.fieldViolations?.[0]?.field, SPLIT_FIELD)).toEqual([]);
  });
  it("the same split as one segment of a longer path gives <unrecognized_field>", () => {
    const d = detailOf(refused("bad", `operations[0].${SPLIT_FIELD}.hashed_email`, "bad"));
    expect(d?.fieldViolations?.[0]?.field).toBe("<unrecognized_field>");
  });
  it("a letters-only split field of 24+ letters gives <unrecognized_field>", () => {
    expect(maskFieldPath(SPLIT_LETTERS)).toBe("<unrecognized_field>");
    expect(detailOf(refused("bad", SPLIT_LETTERS, "bad"))?.fieldViolations?.[0]?.field).toBe("<unrecognized_field>");
  });
  it("a camel-shaped or snake-shaped arbitrary field gives <unrecognized_field>", () => {
    for (const f of [CAMEL_SHAPED, SNAKE_SHAPED, UPPER_SNAKE_SHAPED]) expect(maskFieldPath(f)).toBe("<unrecognized_field>");
  });
  it("a field that IS a known Google name stays readable (the list's field forms)", () => {
    expect(maskFieldPath("termsOfService.customerMatchTermsOfServiceStatus")).toBe("termsOfService.customerMatchTermsOfServiceStatus");
    expect(maskFieldPath("remove_all_audience_members")).toBe("remove_all_audience_members");
  });
  it("boundaries: 15 mixed characters survive, 16 are masked; 23 letters survive, 24 unknown letters are masked", () => {
    expect(maskFieldPath("a1b2c3d4e5f6g7h")).toBe("a1b2c3d4e5f6g7h");
    expect(maskFieldPath("a1b2c3d4e5f6g7h8")).toBe("<unrecognized_field>");
    expect(maskFieldPath("a_b1c2d3e4f5g6h7h8")).toBe("<unrecognized_field>");
    expect(maskFieldPath("abcdefghijklmnopqrstuvw")).toBe("abcdefghijklmnopqrstuvw");
    expect(maskFieldPath("abcdefghijklmnopqrstuvwx")).toBe("<unrecognized_field>");
  });
});

describe("GD-3509: a long run stays readable only when it is a listed Google name", () => {
  it.each([
    ["sparse-capitals camel", CAMEL_SHAPED],
    ["snake letters", SNAKE_SHAPED],
    ["UPPER_SNAKE letters", UPPER_SNAKE_SHAPED],
  ])("%s: masked whole in text, the returned message AND the description", (_n, run) => {
    expect(run.length).toBeGreaterThanOrEqual(24);
    expect(maskPlatformText(`see ${run} now`)).toBe("see <token> now");
    const d = detailOf(refused(`Request failed for ${run} please retry`, "audience_members", `list ${run} is not applicable`));
    expect(d?.message).toBe("Request failed for <token> please retry");
    expect(d?.fieldViolations?.[0]?.description).toBe("list <token> is not applicable");
    expect(leaked(d?.message, run)).toEqual([]);
    expect(leaked(d?.fieldViolations?.[0]?.description, run)).toEqual([]);
  });
  it("a camelCase name that is not on the list is masked: removeAllAudienceMembers was kept by shape in round 1", () => {
    expect(maskPlatformText("x removeAllAudienceMembers y")).toBe("x <token> y");
  });
  it("a listed name with extra characters on it is not the listed name: masked whole", () => {
    expect(maskPlatformText("x customerMatchTermsOfServiceStatusX y")).toBe("x <token> y");
    expect(maskPlatformText("x customerMatchTermsOfServiceStatus_abc y")).toBe("x <token> y");
  });
  it("every listed name stays readable through the message and the description", () => {
    for (const n of GOOGLE_KNOWN_NAMES) {
      expect(maskPlatformText(`name ${n} here`)).toBe(`name ${n} here`);
    }
    const d = detailOf(refused("UNSUPPORTED_USER_LIST_UPLOAD_KEY_TYPES for remove_all_audience_members", "audience_members", "customerMatchTermsOfServiceStatus is required"));
    expect(d?.message).toBe("UNSUPPORTED_USER_LIST_UPLOAD_KEY_TYPES for remove_all_audience_members");
    expect(d?.fieldViolations?.[0]?.description).toBe("customerMatchTermsOfServiceStatus is required");
  });
  it("the list holds every ProcessingErrorReason the package already knows", () => {
    for (const r of GOOGLE_PROCESSING_ERROR_REASONS) expect(GOOGLE_KNOWN_NAMES.has(r)).toBe(true);
  });
  it("the list holds only names of 24+ characters in Google's own alphabet (the shorter ones need no entry)", () => {
    for (const n of GOOGLE_KNOWN_NAMES) {
      expect(n.length).toBeGreaterThanOrEqual(24);
      expect(n).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });
});

describe("unchanged: the confirmed paths and ordinary error text", () => {
  it.each([
    "operations[0].create.user_identifiers[3].hashed_email",
    "audience_members",
    "operations[12].remove",
    "remove_all_audience_members[0]",
    "destinations[0].productDestinationId",
    "termsOfService.customerMatchTermsOfServiceStatus",
  ])("field survives: %s", (f) => {
    expect(detailOf(refused("bad", f, "bad"))?.fieldViolations?.[0]?.field).toBe(f);
  });
  it.each([
    "The provided user list does not exist.",
    "Type of the user list is not applicable for this request.",
    "The request contains an invalid argument in audience_members.",
    "Request contains an invalid argument.",
    "Customer Match is not allowed for this account; the advertiser has not accepted the terms of service.",
    "Quota exceeded for IngestionMutateRequestsPerMinutePerProject on this project.",
    "The user list type is not supported for this account: USER_LIST_TYPE_NOT_SUPPORTED_FOR_ACCOUNT",
    "Invalid value at 'audience_members[0].user_data.user_identifiers[1]' (type.googleapis.com/google.type.Date)",
  ])("ordinary text is unchanged: %s", (t) => {
    expect(maskPlatformText(t)).toBe(t);
    expect(detailOf(refused(t, "audience_members", t))?.message).toBe(t);
  });
  it("the UUID, hex, e-mail and fragment rules are unchanged", () => {
    const uuid = "3f2b1c4d-1a2b-4c3d-8e9f-0123456789ab";
    expect(maskPlatformText(`request ${uuid} failed`)).toBe("request <id> failed");
    expect(maskPlatformText(`x ${uuid}${uuid} y`)).toBe("x <token> y");
    expect(maskPlatformText("hash 0123456789abcdef0123456789abcdef0123 end")).toBe("hash <hex> end");
    expect(maskPlatformText("for averyveryverylongmailboxname1234@example.com now")).toBe("for <email> now");
    expect(maskPlatformText(`see abc${uuid}d now`)).toBe("see <token> now");
  });
});
