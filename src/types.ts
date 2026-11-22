/**
 * The one effective interface (S12 design §7.1 Rev 4, with Rev 5's `Advertiser = { tenantId }`).
 *
 * The package holds HTTP calls, normalization, hashing, batching and the fake. It takes
 * credentials as arguments and imports no Prisma and no token lookup (§6.4 Rev 2).
 */

export type Platform = "META" | "GOOGLE";

/** Rev 5: the advertiser IS a tenant. There is no advertiser enum. */
export interface Advertiser {
  tenantId: string;
}

/** A list key from `AD_AUDIENCE_LISTS` (e.g. `rello_prospects`). */
export type AudienceKey = string;

/**
 * One audience member, already normalized for ONE platform and SHA-256 hashed (lowercase hex).
 * Meta and Google normalize email differently (Google removes Gmail dots and `+tags`), so a
 * member's hashes are per platform: build them with `hashMember(platform, …)`.
 */
export interface HashedMember {
  email?: string;
  phone?: string;
}

/** §4.5 Rev 3 item 2: the request is what is frozen. `body` is sent byte for byte on every attempt. */
export interface FrozenBatch {
  id: string;
  endpoint: string;
  apiVersion: string;
  body: Uint8Array;
  bodySha256: string;
}

/**
 * §7.1 Rev 4, exactly. (Removing a non-member is not an error, §6.2 Rev 2. Neither platform's
 * response says how many were non-members, so no count is invented here.)
 */
export type AdOutcome =
  | { status: "accepted"; platformRef?: string; requestId?: string }
  | { status: "duplicate" }
  | { status: "rejected"; reason: string }
  | { status: "retryable"; reason: string; notBefore?: string }
  | { status: "unknown"; reason: string }
  | { status: "partial"; done: number; failed: number; reason: string }
  | { status: "not_connected" };

export type RequestStatus = "PROCESSING" | "SUCCESS" | "FAILED" | "PARTIAL_SUCCESS" | "UNREADABLE";

export interface AdPlatformClient {
  platform: Platform;
  /** Sends `batch.body` byte for byte to `batch.endpoint`; never rebuilds it. */
  sendConversionBatch(advertiser: Advertiser, batch: FrozenBatch): Promise<AdOutcome>;
  /** `members` [] clears: Meta DELETE of `possiblyApplied` (§6.2 Rev 3); Google remove-all. */
  replaceAudience(
    advertiser: Advertiser,
    list: AudienceKey,
    members: HashedMember[],
    possiblyApplied: HashedMember[],
  ): Promise<AdOutcome>;
  removeFromAudience(advertiser: Advertiser, list: AudienceKey, members: HashedMember[]): Promise<AdOutcome>;
  /** Google only. */
  requestStatus?(advertiser: Advertiser, requestId: string): Promise<RequestStatus>;
}

/** Injected so a Trigger.dev task can pass `wait.for`, and tests can pass a no-op. */
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
