import type { HashedMember, Platform } from "./types.js";
export declare function sha256Hex(value: string): string;
export declare function normalizeEmail(platform: Platform, raw: string): string | null;
/**
 * Meta: digits with the country code, no plus. Google: E.164 with the plus.
 * A number written with `+` or `00` is international as given. A number without either is accepted
 * only when it is unambiguous: 10 national digits (the default country code is added), or the
 * default country code followed by 10 digits. Anything else returns null rather than a guessed hash.
 */
export declare function normalizePhone(platform: Platform, raw: string, opts?: {
    defaultCountryCode?: string;
}): string | null;
/** Normalizes and hashes one person's identifiers for ONE platform. Null when nothing usable is left. */
export declare function hashMember(platform: Platform, input: {
    email?: string | null;
    phone?: string | null;
}, opts?: {
    defaultCountryCode?: string;
}): HashedMember | null;
/** Meta `external_id` (§4.3 Rev 5): SHA-256 of `<tenantId>:<leadId or userId>`. */
export declare function hashExternalId(tenantId: string, subjectId: string): string;
//# sourceMappingURL=normalize.d.ts.map