import type { FrozenBatch } from "./types.js";
export declare function canonicalize(value: unknown): string;
export declare function freezeBatch(input: {
    id: string;
    endpoint: string;
    apiVersion: string;
    request: unknown;
}): FrozenBatch;
/** True when `body` still hashes to `bodySha256`. A mismatch is never sent. */
export declare function frozenBodyMatches(batch: FrozenBatch): boolean;
//# sourceMappingURL=jcs.d.ts.map