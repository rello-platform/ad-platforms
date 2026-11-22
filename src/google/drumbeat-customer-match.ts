/**
 * MOVED from The-Drumbeat `src/lib/google/audiences.ts` and `src/lib/google/customer-id.ts`
 * @ 960ea5e629bbdbf2b7fa505a4f3b2521f1b6843d (S12a), behaviour unchanged. The ONLY change: the
 * Prisma connection lookup and `getGoogleAccessToken` stay in the Drumbeat, which now passes
 * `{ accessToken, developerToken, apiBase, accountId }` in (apiBase = its GOOGLE_ADS_API_BASE).
 *
 * This is the Google Ads API offlineUserDataJobs path the Drumbeat uses. Rello's S12 Customer
 * Match client is the Data Manager API (`./client.ts`): new integrations must use Data Manager.
 */
import type { AudienceMember } from "../meta/drumbeat-audiences.js";
import * as crypto from "crypto";

export interface GoogleAdsApiCredentials {
  accessToken: string;
  /** The Drumbeat's GOOGLE_ADS_DEVELOPER_TOKEN_VALUE. */
  developerToken: string;
  /** The Drumbeat's GOOGLE_ADS_API_BASE. */
  apiBase: string;
  /** `AdAccountConnection.accountId` for the GOOGLE row. */
  accountId: string;
}

// --- from customer-id.ts, verbatim ---

const CUSTOMER_ID = /^\d{1,19}$/;

export function parseGoogleAdsCustomerId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^customers\//, "").replace(/-/g, "");
  return CUSTOMER_ID.test(raw) ? raw : null;
}

export function googleAdsCustomerPath(apiBase: string, accountId: string): string {
  const customerId = parseGoogleAdsCustomerId(accountId);
  if (!customerId) {
    throw new Error(
      `Stored Google account "${accountId}" is not a Google Ads customer id; reconnect Google Ads to record the customer Google issued`,
    );
  }
  return `${apiBase}/customers/${customerId}`;
}

// --- from audiences.ts ---

// Google's offlineUserDataJobs addOperations ceiling per request.
const BATCH_SIZE = 100_000;

function googleHeaders(accessToken: string, developerToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// PII hashing (Google Customer Match rules)
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Lowercase, trim, and (for gmail) strip dots before the @ per Google rules. */
function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at === -1) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "")}@${domain}`;
  }
  return trimmed;
}

/** Best-effort E.164 normalization: strip non-digits, prepend +; default US +1. */
function normalizePhoneE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (phone.trim().startsWith("+")) return `+${digits}`;
  // 10-digit US number → +1XXXXXXXXXX; 11-digit starting with 1 → +1...
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Build one Customer Match user-identifier object per member. Google accepts
 * multiple identifier objects per operation; we emit one operation per member
 * carrying whichever identifiers are present (hashed email + hashed phone, or
 * an addressInfo block with hashed given/family name).
 */
function memberToOperations(member: AudienceMember): Array<{ create: Record<string, unknown> }> {
  const ops: Array<{ create: Record<string, unknown> }> = [];

  if (member.email) {
    ops.push({ create: { userIdentifiers: [{ hashedEmail: sha256Hex(normalizeEmail(member.email)) }] } });
  }
  if (member.phone) {
    const e164 = normalizePhoneE164(member.phone);
    if (e164) {
      ops.push({ create: { userIdentifiers: [{ hashedPhoneNumber: sha256Hex(e164) }] } });
    }
  }
  if (member.firstName && member.lastName) {
    ops.push({
      create: {
        userIdentifiers: [
          {
            addressInfo: {
              hashedFirstName: sha256Hex(member.firstName.trim().toLowerCase()),
              hashedLastName: sha256Hex(member.lastName.trim().toLowerCase()),
              ...(member.zip ? { postalCode: member.zip.trim() } : {}),
              ...(member.state ? { countryCode: "US" } : {}),
            },
          },
        ],
      },
    });
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Create Customer Match user list
// ---------------------------------------------------------------------------

/**
 * Create a Customer Match (CRM-based) user list via userLists:mutate.
 * Returns the resource name (`customers/<cid>/userLists/<id>`) as the
 * externalAudienceId, matching the Meta-side return shape.
 */
export async function createGoogleCustomerMatchAudience(
  credentials: GoogleAdsApiCredentials,
  name: string,
  description: string,
): Promise<{ externalAudienceId: string }> {
  const { accessToken, developerToken, apiBase: GOOGLE_ADS_API_BASE } = credentials;

  const res = await fetch(
    `${googleAdsCustomerPath(GOOGLE_ADS_API_BASE, credentials.accountId)}/userLists:mutate`,
    {
      method: "POST",
      headers: googleHeaders(accessToken, developerToken),
      body: JSON.stringify({
        operations: [
          {
            create: {
              name,
              description,
              membershipLifeSpan: 540, // days (Google max for Customer Match)
              crmBasedUserList: {
                uploadKeyType: "CONTACT_INFO",
                dataSourceType: "FIRST_PARTY",
              },
            },
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Google Customer Match user list creation failed (${res.status}): ${body}`,
    );
  }

  const data = (await res.json()) as { results?: Array<{ resourceName: string }> };
  const resourceName = data.results?.[0]?.resourceName;
  if (!resourceName) {
    throw new Error(
      `Google Customer Match user list creation returned no resourceName: ${JSON.stringify(data)}`,
    );
  }
  return { externalAudienceId: resourceName };
}

// ---------------------------------------------------------------------------
// Sync members (offlineUserDataJobs)
// ---------------------------------------------------------------------------

/**
 * Upload hashed member data to a Customer Match user list via the
 * offlineUserDataJobs flow: create job → addOperations (100k batches) → run.
 * Mirrors the Meta-side `{ uploaded, batches }` return shape.
 *
 * Idempotent at the platform level — Google's Customer Match member set is
 * additive (re-uploading the same hashed identifiers is a no-op for set size),
 * so trigger-level retries are safe.
 */
export async function syncGoogleAudienceMembers(
  credentials: GoogleAdsApiCredentials,
  externalAudienceId: string,
  members: AudienceMember[],
): Promise<{ uploaded: number; batches: number }> {
  const { accessToken, developerToken, apiBase: GOOGLE_ADS_API_BASE } = credentials;
  const customerPath = googleAdsCustomerPath(GOOGLE_ADS_API_BASE, credentials.accountId);
  const headers = googleHeaders(accessToken, developerToken);

  // Empty member set is valid — nothing to upload.
  if (members.length === 0) {
    return { uploaded: 0, batches: 0 };
  }

  // 1. Create the offline user data job bound to this user list.
  const createRes = await fetch(`${customerPath}/offlineUserDataJobs:create`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      job: {
        type: "CUSTOMER_MATCH_USER_LIST",
        customerMatchUserListMetadata: { userList: externalAudienceId },
      },
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(
      `Google offlineUserDataJobs:create failed (${createRes.status}): ${body}`,
    );
  }
  const createData = (await createRes.json()) as { resourceName?: string };
  const jobResourceName = createData.resourceName;
  if (!jobResourceName) {
    throw new Error(
      `Google offlineUserDataJobs:create returned no resourceName: ${JSON.stringify(createData)}`,
    );
  }

  // 2. Add operations in batches (Google ceiling is 100k operations/request).
  let uploaded = 0;
  let batches = 0;
  const allOps = members.flatMap(memberToOperations);

  for (let i = 0; i < allOps.length; i += BATCH_SIZE) {
    const batch = allOps.slice(i, i + BATCH_SIZE);
    const addRes = await fetch(
      `${GOOGLE_ADS_API_BASE}/${jobResourceName}:addOperations`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          operations: batch,
          enablePartialFailure: true,
        }),
      },
    );
    if (!addRes.ok) {
      const body = await addRes.text();
      throw new Error(
        `Google offlineUserDataJobs:addOperations failed batch ${batches + 1} (${addRes.status}): ${body}`,
      );
    }
    uploaded += batch.length;
    batches++;
  }

  // 3. Run the job (async server-side processing).
  const runRes = await fetch(`${GOOGLE_ADS_API_BASE}/${jobResourceName}:run`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  if (!runRes.ok) {
    const body = await runRes.text();
    throw new Error(
      `Google offlineUserDataJobs:run failed (${runRes.status}): ${body}`,
    );
  }

  console.info(
    `[google/audiences] Customer Match upload: ${uploaded} operations in ${batches} batch(es) for ${externalAudienceId}`,
  );

  return { uploaded, batches };
}
