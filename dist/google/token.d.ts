/**
 * Why a credentials JSON is unusable, as a fixed code (GD-2954): a caller logs `code`, never a message.
 */
export declare class GoogleCredentialsError extends Error {
    readonly code: "google_credentials_not_json" | "google_credentials_no_client_email" | "google_credentials_no_private_key";
    constructor(code: "google_credentials_not_json" | "google_credentials_no_client_email" | "google_credentials_no_private_key", message: string);
}
export declare function serviceAccountTokenSource(credentialsJson: string, opts?: {
    scope?: string;
    timeoutMs?: number;
    now?: () => Date;
}): () => Promise<string>;
//# sourceMappingURL=token.d.ts.map