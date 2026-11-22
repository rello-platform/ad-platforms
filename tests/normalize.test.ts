/**
 * Normalization vectors from the platforms' own pages (read 2026-11-22; quoted in README "Sources").
 * The expected digests are literal hex from those pages, not computed by the code under test.
 */
import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizePhone, sha256Hex, hashMember, hashExternalId } from "../src/index.js";

describe("SHA-256 primitive", () => {
  it("is lowercase hex SHA-256 of the UTF-8 bytes (Meta's own example digest)", () => {
    expect(sha256Hex("john_smith@gmail.com")).toBe("62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f");
  });
});

describe("Meta Conversions API — customer information parameters", () => {
  it("em: John_Smith@gmail.com normalizes to john_smith@gmail.com (Meta's example)", () => {
    expect(normalizeEmail("META", "John_Smith@gmail.com")).toBe("john_smith@gmail.com");
    expect(hashMember("META", { email: "John_Smith@gmail.com" })).toEqual({
      email: "62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f",
    });
  });

  it("em: trims leading and trailing spaces and lowercases", () => {
    expect(normalizeEmail("META", "  Jane.Doe@Example.COM \t")).toBe("jane.doe@example.com");
  });

  it("em: Meta states no Gmail dot rule, so dots and +tags are kept", () => {
    expect(normalizeEmail("META", "J.Smith+ads@Gmail.com")).toBe("j.smith+ads@gmail.com");
  });

  it("ph: (650)555-1212 normalizes to 16505551212 (Meta's example, US country code added)", () => {
    expect(normalizePhone("META", "(650)555-1212")).toBe("16505551212");
    expect(hashMember("META", { phone: "(650)555-1212" })).toEqual({
      phone: "e323ec626319ca94ee8bff2e4c87cf613be6ea19919ed1364124e16807ab3176",
    });
  });

  it("ph: removes symbols, letters and leading zeros; keeps a caller's country code", () => {
    expect(normalizePhone("META", "+1 (801) 555-0142")).toBe("18015550142");
    expect(normalizePhone("META", "+44 020 7946 0958")).toBe("4402079460958");
    expect(normalizePhone("META", "00 1 801 555 0142")).toBe("18015550142");
  });

  it("invalid identifiers are null, never a hash of junk", () => {
    expect(normalizeEmail("META", "not-an-email")).toBeNull();
    expect(normalizeEmail("META", "   ")).toBeNull();
    expect(normalizePhone("META", "12345")).toBeNull();
    expect(normalizePhone("META", "")).toBeNull();
    expect(hashMember("META", { email: "junk", phone: "1" })).toBeNull();
  });
});

describe("Google Data Manager — formatting guidelines", () => {
  it("email: john.smith@EXAMPLE.COM → john.smith@example.com → 8E621E3D… (Google's example)", () => {
    expect(normalizeEmail("GOOGLE", "john.smith@EXAMPLE.COM")).toBe("john.smith@example.com");
    expect(hashMember("GOOGLE", { email: "john.smith@EXAMPLE.COM" })).toEqual({
      email: "8e621e3d0368631d263d07a351fa8d34fba0d17c15fbcdec11a5f58008d022a0",
    });
  });

  it("phone: +1 (800) 555-0199 → +18005550199 → 78724165… (Google's example)", () => {
    expect(normalizePhone("GOOGLE", "+1 (800) 555-0199")).toBe("+18005550199");
    expect(hashMember("GOOGLE", { phone: "+1 (800) 555-0199" })).toEqual({
      phone: "78724165620b8a76386cab242569ebc85dd2346f3f5ae88dc13bb57e31020b90",
    });
  });

  it("phone: (800)555-0100 → +18005550100 (Google's US example)", () => {
    expect(normalizePhone("GOOGLE", "(800)555-0100")).toBe("+18005550100");
  });

  it("gmail.com: removes every dot before @ and the +tag (Google's example)", () => {
    expect(normalizeEmail("GOOGLE", "cloudy.sanfrancisco+shopping@gmail.com")).toBe("cloudysanfrancisco@gmail.com");
  });

  it("googlemail.com gets the same rule", () => {
    expect(normalizeEmail("GOOGLE", "Jane.Q.Doe+x@GoogleMail.com")).toBe("janeqdoe@googlemail.com");
  });

  it("other domains keep dots and +tags, lowercased (Google's example)", () => {
    expect(normalizeEmail("GOOGLE", "user.name+NYC@Example.com")).toBe("user.name+nyc@example.com");
  });

  it("trims leading, trailing and intermediate whitespace", () => {
    expect(normalizeEmail("GOOGLE", "  jane doe@example.com ")).toBe("janedoe@example.com");
  });

  it("the two platforms hash a Gmail address differently", () => {
    const m = hashMember("META", { email: "a.b@gmail.com" });
    const g = hashMember("GOOGLE", { email: "a.b@gmail.com" });
    expect(m?.email).toBe(sha256Hex("a.b@gmail.com"));
    expect(g?.email).toBe(sha256Hex("ab@gmail.com"));
  });

  it("invalid identifiers are null", () => {
    expect(normalizeEmail("GOOGLE", "nobody")).toBeNull();
    expect(normalizePhone("GOOGLE", "555-1234")).toBeNull();
    expect(normalizePhone("GOOGLE", "+1 2")).toBeNull();
  });
});

describe("external_id (§4.3 Rev 5)", () => {
  it("is SHA-256 of <tenantId>:<subjectId>", () => {
    expect(hashExternalId("tenant_rello_growth", "user_1")).toBe(sha256Hex("tenant_rello_growth:user_1"));
  });

  it("refuses an empty tenant or subject", () => {
    expect(() => hashExternalId("", "user_1")).toThrow();
    expect(() => hashExternalId("tenant_rello_growth", " ")).toThrow();
  });
});
