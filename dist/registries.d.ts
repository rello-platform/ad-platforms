/**
 * The kind and list registries (S12 design §4.2 Rev 5 item 2). Each entry carries a `scope`:
 * - `house`: only the house tenant (Rello's own ads) may enable it;
 * - `any`: any advertiser, house included;
 * - `tenant`: reserved for PLATFORM-TENANT-ADS T7; never the house.
 *
 * A key outside its scope for a tenant is refused at write (400) and ignored-and-counted at read.
 * So a tenant row can never enable `signup` or `rello_customers`.
 */
export type RegistryScope = "house" | "any" | "tenant";
export declare const AD_CONVERSION_KINDS: {
    readonly signup: {
        readonly scope: "house";
    };
    readonly lead: {
        readonly scope: "any";
    };
    readonly funded_loan: {
        readonly scope: "any";
    };
    readonly funded_loan_retract: {
        readonly scope: "any";
    };
};
export declare const AD_AUDIENCE_LISTS: {
    readonly rello_prospects: {
        readonly scope: "house";
    };
    readonly rello_customers: {
        readonly scope: "house";
    };
    readonly tenant_leads: {
        readonly scope: "tenant";
    };
    readonly tenant_past_clients: {
        readonly scope: "tenant";
    };
};
export type AdConversionKind = keyof typeof AD_CONVERSION_KINDS;
export type AdAudienceList = keyof typeof AD_AUDIENCE_LISTS;
/** True only for a registered kind whose scope admits this advertiser. Unknown keys are false. */
export declare function isConversionKindAllowed(kind: string, isHouse: boolean): kind is AdConversionKind;
/** True only for a registered list whose scope admits this advertiser. Unknown keys are false. */
export declare function isAudienceListAllowed(list: string, isHouse: boolean): list is AdAudienceList;
//# sourceMappingURL=registries.d.ts.map