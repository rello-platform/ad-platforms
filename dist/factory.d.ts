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
export declare function createAdPlatformClient(platform: Platform, env: AdEnv, options?: {
    timeoutMs?: number;
    sleep?: Sleep;
    statusPollMs?: number;
    statusMaxReads?: number;
}): AdPlatformClient;
//# sourceMappingURL=factory.d.ts.map