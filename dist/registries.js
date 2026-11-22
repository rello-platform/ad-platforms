/**
 * The kind and list registries (S12 design §4.2 Rev 5 item 2). Each entry carries a `scope`:
 * - `house`: only the house tenant (Rello's own ads) may enable it;
 * - `any`: any advertiser, house included;
 * - `tenant`: reserved for PLATFORM-TENANT-ADS T7; never the house.
 *
 * A key outside its scope for a tenant is refused at write (400) and ignored-and-counted at read.
 * So a tenant row can never enable `signup` or `rello_customers`.
 */
export const AD_CONVERSION_KINDS = {
    signup: { scope: "house" },
    lead: { scope: "any" },
    funded_loan: { scope: "any" },
    funded_loan_retract: { scope: "any" },
};
export const AD_AUDIENCE_LISTS = {
    rello_prospects: { scope: "house" },
    rello_customers: { scope: "house" },
    tenant_leads: { scope: "tenant" },
    tenant_past_clients: { scope: "tenant" },
};
function scopeAllows(scope, isHouse) {
    if (scope === "any")
        return true;
    return isHouse ? scope === "house" : scope === "tenant";
}
/** True only for a registered kind whose scope admits this advertiser. Unknown keys are false. */
export function isConversionKindAllowed(kind, isHouse) {
    if (!Object.prototype.hasOwnProperty.call(AD_CONVERSION_KINDS, kind))
        return false;
    return scopeAllows(AD_CONVERSION_KINDS[kind].scope, isHouse);
}
/** True only for a registered list whose scope admits this advertiser. Unknown keys are false. */
export function isAudienceListAllowed(list, isHouse) {
    if (!Object.prototype.hasOwnProperty.call(AD_AUDIENCE_LISTS, list))
        return false;
    return scopeAllows(AD_AUDIENCE_LISTS[list].scope, isHouse);
}
