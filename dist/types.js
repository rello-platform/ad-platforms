/**
 * The one effective interface (S12 design §7.1 Rev 4, with Rev 5's `Advertiser = { tenantId }`).
 *
 * The package holds HTTP calls, normalization, hashing, batching and the fake. It takes
 * credentials as arguments and imports no Prisma and no token lookup (§6.4 Rev 2).
 */
export const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
