import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  canonicalize,
  freezeBatch,
  frozenBodyMatches,
  AD_CONVERSION_KINDS,
  AD_AUDIENCE_LISTS,
  isConversionKindAllowed,
  isAudienceListAllowed,
} from "../src/index.js";

describe("RFC 8785 canonicalization (§4.5 Rev 3 item 2)", () => {
  it("matches RFC 8785 §3.2.2's sample", () => {
    const input = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
      literals: [null, true, false],
    };
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts keys by UTF-16 code units (RFC 8785 §3.2.3's sample)", () => {
    const input: Record<string, string> = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      "ö": "Latin Small Letter O With Diaeresis",
    };
    // Read the keys from the canonical TEXT: Object.keys would list integer-like keys ("1") first.
    const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    expect(canonicalize(input).startsWith('{"\\r":')).toBe(true);
    expect(keys).toEqual(["\r", "1", "\u0080", "ö", "€", "😀", "דּ"]);
  });

  it("refuses values JSON cannot carry exactly", () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalize({ a: 1n })).toThrow();
    expect(() => canonicalize({ a: () => 1 })).toThrow();
  });

  it("drops undefined members, as JSON does", () => {
    expect(canonicalize({ b: 1, a: undefined })).toBe('{"b":1}');
  });

  it("freezeBatch stores the exact canonical bytes and their sha256", () => {
    const b = freezeBatch({ id: "batch_1", endpoint: "https://x.test/e", apiVersion: "v1", request: { z: 1, a: [2, 3] } });
    expect(new TextDecoder().decode(b.body)).toBe('{"a":[2,3],"z":1}');
    expect(b.bodySha256).toBe(createHash("sha256").update(b.body).digest("hex"));
    expect(frozenBodyMatches(b)).toBe(true);
    expect(frozenBodyMatches({ ...b, bodySha256: "0".repeat(64) })).toBe(false);
  });

  it("freezeBatch refuses an empty id or endpoint", () => {
    expect(() => freezeBatch({ id: "", endpoint: "https://x.test", apiVersion: "v1", request: {} })).toThrow();
    expect(() => freezeBatch({ id: "b", endpoint: "", apiVersion: "v1", request: {} })).toThrow();
  });
});

describe("registries carry scope (§4.2 Rev 5)", () => {
  it("lists every kind and list with its scope", () => {
    expect(AD_CONVERSION_KINDS).toEqual({
      signup: { scope: "house" },
      lead: { scope: "any" },
      funded_loan: { scope: "any" },
      funded_loan_retract: { scope: "any" },
    });
    expect(AD_AUDIENCE_LISTS).toEqual({
      rello_prospects: { scope: "house" },
      rello_customers: { scope: "house" },
      tenant_leads: { scope: "tenant" },
      tenant_past_clients: { scope: "tenant" },
    });
  });

  it("a tenant row can never enable signup or rello_customers", () => {
    expect(isConversionKindAllowed("signup", false)).toBe(false);
    expect(isAudienceListAllowed("rello_customers", false)).toBe(false);
    expect(isConversionKindAllowed("lead", false)).toBe(true);
    expect(isAudienceListAllowed("tenant_leads", false)).toBe(true);
  });

  it("the house may enable house and any-scope keys, never tenant ones", () => {
    expect(isConversionKindAllowed("signup", true)).toBe(true);
    expect(isConversionKindAllowed("funded_loan", true)).toBe(true);
    expect(isAudienceListAllowed("rello_prospects", true)).toBe(true);
    expect(isAudienceListAllowed("tenant_past_clients", true)).toBe(false);
  });

  it("unknown keys are refused, including prototype names", () => {
    expect(isConversionKindAllowed("purchase", true)).toBe(false);
    expect(isConversionKindAllowed("toString", true)).toBe(false);
    expect(isAudienceListAllowed("__proto__", false)).toBe(false);
  });
});
