/**
 * PLATFORM AUDIT 163 HOLD on ad-platforms #2 (Platform KA prompt 2150, Part B).
 *
 * GD-3505: the UUID rule ran before the whole-opaque-run rule, so a 40-character run of 3 letters + a UUID + 1 letter
 *          came out as "abc<id>d": a fragment of the run survived, through `message` and `description` alike.
 * GD-3506: a field name that matches the path shape was copied whole, so a 40-character letters-and-digits run in
 *          `field` came back unmasked.
 * KA:      the opaque-run rule kept a 24+ run with letters but no digits.
 */
import { describe, expect, it } from "vitest";
import { googleErrorDetail, maskPlatformText } from "../src/google/error-detail.js";

const CANONICAL = new Set(["INVALID_ARGUMENT", "NOT_FOUND", "PERMISSION_DENIED"]);
const UUID = "3f2b1c4d-1a2b-4c3d-8e9f-0123456789ab";
/** The auditor's deterministic fixture: 3 letters + a UUID + 1 letter, 40 characters. */
const FIXTURE = `abc${UUID}d`;

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

const badRequest = (field: string, description: string) => ({
  error: {
    code: 400,
    status: "INVALID_ARGUMENT",
    message: `Request failed for ${FIXTURE} please retry`,
    details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field, reason: "INVALID_USER_LIST_TYPE", description }] }],
  },
});

describe("GD-3505: an opaque run is masked whole, before any rule can split it", () => {
  it("the fixture is 40 characters", () => {
    expect(FIXTURE).toHaveLength(40);
  });

  it("maskPlatformText leaves no 3-character fragment of the fixture", () => {
    const m = maskPlatformText(`see ${FIXTURE} now`);
    expect(m).toBe("see <token> now");
    expect(leaked(m, FIXTURE)).toEqual([]);
  });

  it("through googleErrorDetail: neither message nor description keeps a fragment", () => {
    const d = googleErrorDetail(400, badRequest("audience_members", `list ${FIXTURE} is not applicable`), CANONICAL);
    expect(d.message).toBe("Request failed for <token> please retry");
    expect(d.fieldViolations?.[0]?.description).toBe("list <token> is not applicable");
    expect(leaked(d.message, FIXTURE)).toEqual([]);
    expect(leaked(d.fieldViolations?.[0]?.description, FIXTURE)).toEqual([]);
  });

  it("a UUID on its own still reads <id>; inside a longer run the whole run is <token>", () => {
    expect(maskPlatformText(`request ${UUID} failed`)).toBe("request <id> failed");
    expect(maskPlatformText(`x ${UUID}${UUID} y`)).toBe("x <token> y");
  });

  it("an e-mail with a 24+ local part or label is still masked whole as <email>", () => {
    expect(maskPlatformText("for averyveryverylongmailboxname1234@example.com now")).toBe("for <email> now");
    expect(maskPlatformText("for kelly@averyveryverylongdomainlabel99x.example.com now")).toBe("for <email> now");
  });
});

describe("KA addition: a 24+ run of letters only is masked too", () => {
  it.each([
    ["32 mixed-case letters", "QwErTyUiOpAsDfGhJkLzXcVbNmQwErTy"],
    ["32 lower-case letters", "qwertyuiopasdfghjklzxcvbnmqwerty"],
    ["24 upper-case letters", "QWERTYUIOPASDFGHJKLZXCVB"],
    ["24 letters in alternating case", "qwErTyUiOpAsDfGhJkLzXcVb"],
  ])("%s", (_name, run) => {
    expect(run.length).toBeGreaterThanOrEqual(24);
    const m = maskPlatformText(`token ${run} rejected`);
    expect(m).toBe("token <token> rejected");
    expect(leaked(m, run)).toEqual([]);
  });

  it("23 letters is under the floor and stays readable", () => {
    expect(maskPlatformText("word abcdefghijklmnopqrstuvw end")).toBe("word abcdefghijklmnopqrstuvw end");
  });

  it("Google's own names stay readable: snake_case fields, camelCase fields, UPPER_SNAKE reasons", () => {
    const text = "remove_all_audience_members failed: removeAllAudienceMembers customerMatchTermsOfServiceStatus UNSUPPORTED_USER_LIST_UPLOAD_KEY_TYPES";
    expect(maskPlatformText(text)).toBe(text);
  });

  it("the real S13 description passes unchanged", () => {
    expect(maskPlatformText("Type of the user list is not applicable for this request.")).toBe("Type of the user list is not applicable for this request.");
  });
});

describe("GD-3506: a field is kept only when every segment is a plausible API field name", () => {
  it("a 40-character letters-and-digits field name gives <unrecognized_field>", () => {
    const field = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0";
    expect(field).toHaveLength(40);
    const d = googleErrorDetail(400, badRequest(field, "bad"), CANONICAL);
    expect(d.fieldViolations?.[0]?.field).toBe("<unrecognized_field>");
  });

  it("the same run as one segment of a longer path gives <unrecognized_field>", () => {
    const d = googleErrorDetail(400, badRequest("operations[0].Zx9Qw8Er7Ty6Ui5Op4.hashed_email", "bad"), CANONICAL);
    expect(d.fieldViolations?.[0]?.field).toBe("<unrecognized_field>");
  });

  it("a segment over 40 characters gives <unrecognized_field>", () => {
    const d = googleErrorDetail(400, badRequest(`destinations[0].${"a".repeat(41)}`, "bad"), CANONICAL);
    expect(d.fieldViolations?.[0]?.field).toBe("<unrecognized_field>");
  });

  it.each([
    "operations[0].create.user_identifiers[3].hashed_email",
    "audience_members",
    "operations[12].remove",
    "remove_all_audience_members[0]",
    "destinations[0].productDestinationId",
  ])("an ordinary path survives unchanged: %s", (field) => {
    const d = googleErrorDetail(400, badRequest(field, "bad"), CANONICAL);
    expect(d.fieldViolations?.[0]?.field).toBe(field);
  });
});
