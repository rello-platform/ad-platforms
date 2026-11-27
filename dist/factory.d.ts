import type { AdPlatformClient, Platform, Sleep } from "./types.js";
export type AdEnv = Record<string, string | undefined>;
export interface HouseAdConfig {
    meta: {
        apiBase: string;
        apiVersion: string;
        datasetId?: string;
        adAccountId?: string;
        audienceIds: Record<string, string>;
    };
    google: {
        apiBase: string;
        operatingAccountId?: string;
        loginAccountId?: string;
        conversionActionIds: Record<string, string>;
        userListIds: Record<string, string>;
    };
}
/** The non-secret house ids. Never returns a token or the credentials JSON. */
export declare function readHouseAdConfig(env: AdEnv): HouseAdConfig;
export declare function notConnectedClient(platform: Platform): AdPlatformClient;
/**
 * v0.2.0: `options.sleep` is REQUIRED (it was optional and defaulted to a plain timer). Both clients wait between
 * status reads (Google 30 min, Meta 30 s); inside a Trigger.dev task that wait must be `wait.for`, or it counts
 * against maxDuration. A script passes `realSleep` on purpose.
 */
export interface AdPlatformClientOptions {
    timeoutMs?: number;
    sleep: Sleep;
    statusPollMs?: number;
    statusMaxReads?: number;
}
export declare function createAdPlatformClient(platform: Platform, env: AdEnv, options: AdPlatformClientOptions): AdPlatformClient;
//# sourceMappingURL=factory.d.ts.map