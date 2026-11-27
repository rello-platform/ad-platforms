# @rello-platform/ad-platforms

The ad-platform HTTP clients for the Rello platform (S12a of `DESIGN-TRACKING-S12-ADS-LAYER-261122.md`, Rev 5):

- **Meta**: Conversions API sends of frozen batches; custom-audience remove (`DELETE /{audience}/users`), replace (`POST /{audience}/usersreplace` sessions) and clear.
- **Google Data Manager API**: conversions (`events:ingest`) of frozen batches; Customer Match `audienceMembers:ingest` / `:remove` / `:removeAll`; `requestStatus:retrieve`.
- **The Drumbeat's audience clients, moved in with behaviour unchanged**: the Graph v21.0 custom-audience create and add (`createMetaCustomAudience`, `syncAudienceMembers`, `projectMembersToMetaPayload`) and the Google Ads API Customer Match create and sync (`createGoogleCustomerMatchAudience`, `syncGoogleAudienceMembers`). The Drumbeat keeps its Prisma lookup and token decryption and passes the credentials in. The Drumbeat re-pin is a separate unit.
- Per-platform normalization and SHA-256 (`normalizeEmail`, `normalizePhone`, `hashMember`, `hashExternalId`).
- RFC 8785 canonical JSON and `FrozenBatch` (`freezeBatch`, `frozenBodyMatches`). A batch whose body no longer matches its sha256 is never sent.
- The registries with scope (`AD_CONVERSION_KINDS`, `AD_AUDIENCE_LISTS`, `isConversionKindAllowed`, `isAudienceListAllowed`). `Advertiser` is `{ tenantId }`.
- `createAdPlatformClient(platform, env)`: missing credentials give a `not_connected` client that makes 0 network calls.
- `@rello-platform/ad-platforms/fake`: a local HTTP server holding remote member sets, with response-loss modes (hang, drop, stall, any status) and scripted request statuses.

It holds **no credential, no key value, no tenant data and no Prisma**. Credentials are arguments.

## Install

```json
"@rello-platform/ad-platforms": "github:rello-platform/ad-platforms#v0.2.0"
```

**v0.2.0 is breaking** (S13, Platform KA prompt 2138): `createAdPlatformClient(platform, env, { sleep })` and
`createGoogleClient(config, { sleep, … })` REQUIRE `sleep`, and throw a `TypeError` at once without it. Every status
wait (Google 30 min before each read, Meta 30 s) goes through it. In a Trigger.dev task pass `wait.for` (a
checkpointed wait: not compute time, so it never counts against `maxDuration`); a script passes `realSleep` on purpose.
v0.1.0 defaulted to a plain timer, and an accepted Google audience write would have slept 30 min inside a 900 s task
before its first status read.

`dist/` is committed at each tag (the `tracking` pattern).

## Outcomes

Every operation returns an `AdOutcome` (§7.1 Rev 4): `accepted` (Google: with `requestId`), `duplicate`, `rejected`, `retryable` (Google daily quota: with `notBefore`, the next 00:00 America/Los_Angeles), `unknown`, `partial`, `not_connected`.

| Situation | Meta | Google |
|---|---|---|
| Failure before the request was written (DNS, connect, TLS) | retryable | retryable |
| Timeout or reset after writing, unparseable answer | unknown | unknown |
| 5xx / 429 | unknown | UNAVAILABLE, DEADLINE_EXCEEDED, INTERNAL, UNKNOWN, ABORTED: retryable |
| Parameter / token / permission error | rejected (codes 100, 102, 190, 10, 200–299) | INVALID_ARGUMENT, PERMISSION_DENIED, UNAUTHENTICATED, NOT_FOUND, FAILED_PRECONDITION: rejected |
| Quota | — | per minute: retryable `quota_per_minute`; per day: retryable `quota_daily` + `notBefore`; no ErrorInfo: `quota_unclassified` + daily `notBefore` |
| Access token can't be minted | — | retryable, 0 ingest requests |

"Written" is measured on the socket (`src/http.ts`): the request counts as possibly written once the connection (and TLS) is up.

Audiences:

- **Meta replace** runs one `usersreplace` session in batches of ≤ 10,000. A session timeout (2650/1870158) leaves the list "replaced with what you've uploaded so far", so the result is `partial` and the next full run converges. After the last batch, `operation_status` is read until it leaves `replace_in_progress`. `replace_error` gives `partial`.
- **Meta clear** (an empty target) DELETEs the possibly-applied set. It never sends an empty `usersreplace`.
- **Google replace** records T, ingests, waits for the request status to reach SUCCESS, then sends `removeAll` with `removeAsOfTime = T`. A FAILED or still-PROCESSING ingest sends no `removeAll`, so the list is never emptied by a failed upload.
- **Google clear** is `removeAll` with no time.
- **Google status reads** (v0.2.0) each ask the token source first: the reads span up to `statusMaxReads × statusPollMs`
  (6 h by default) and a token lives 1 h. A read with no token is `UNREADABLE`, so the write is never reported done.

### Error detail (v0.2.0, Google)

A Google answer that is an error (`rejected`, `retryable`, `unknown`, or `partial` after a later batch) carries
`detail` (`PlatformErrorDetail`, built only in `src/google/error-detail.ts`): `httpStatus`; `status` when it is a gRPC
canonical code; `message`, masked; up to 10 `fieldViolations` (`field` only when it is a field path whose every segment
is a plausible field name: at most 40 characters and, judged whole with underscores ignored, neither 24+ letters-and-digits nor 16+ mixing letters and digits, unless it is a listed Google name; else `<unrecognized_field>`;
`reason` only when UPPER_SNAKE; `description` masked); `errorInfo` `reason` / `domain`. Masked: control characters are
dropped; then every run of 24+ characters from `A-Z a-z 0-9 _ - + / =` is replaced whole, before any other rule (an
exact UUID `<id>`, all hex `<hex>`, anything else `<token>`, letters only included and shaped-like-a-name included; a run stays
readable only when it is exactly a name in `src/google/known-names.ts`, Google's published error reasons and the field and quota names this package handles); then every e-mail, hex run of 16+, phone-like run and digit run of 6+ becomes `<email>` /
`<hex>` / `<id>`; then the text is cut to 300 characters. `reason` is unchanged (a fixed code), so a log line printing `reason` carries no platform text.

## Env names (`createAdPlatformClient`, `readHouseAdConfig`)

| Name | Use |
|---|---|
| `ADS_HOUSE_META_CAPI_TOKEN` | secret; absent or blank → Meta not_connected |
| `ADS_HOUSE_META_DATASET_ID`, `ADS_HOUSE_META_AD_ACCOUNT_ID` | ids |
| `ADS_HOUSE_META_AUDIENCE_RELLO_PROSPECTS`, `ADS_HOUSE_META_AUDIENCE_RELLO_CUSTOMERS` | Meta custom audience ids. **PROVISIONAL: not in the design's §7.3 Rev 5 table**, which names no source for a Meta audience id. Pending the KA's ruling; the client itself takes `audienceIds` as config. |
| `ADS_GOOGLE_CREDENTIALS_JSON` | secret (service account); absent, blank or unusable → Google not_connected |
| `ADS_HOUSE_GOOGLE_CUSTOMER_ID`, `ADS_HOUSE_GOOGLE_LOGIN_CUSTOMER_ID` | ids (hyphens removed) |
| `ADS_HOUSE_GOOGLE_CONVERSION_ACTION_SIGNUP`, `…_LEAD` | conversion action ids (§7.3 Rev 5 names these two only) |
| `ADS_HOUSE_GOOGLE_USER_LIST_RELLO_PROSPECTS`, `…_RELLO_CUSTOMERS` | Customer Match user list ids |
| `ADS_META_API_BASE`, `ADS_GOOGLE_DATAMANAGER_API_BASE` | test overrides (the fake) |

## Sources (read 2026-11-22)

- Meta Custom Audiences: users (add/remove), usersreplace (sessions, batch_seq, last_batch_flag, estimated_num_total; error 2650 with subcodes 1870145, 1870147, 1870158, 1870159; `operation_status` values Normal / replace_in_progress / replace_error / 471), 10,000 per batch.
- Meta Conversions API: `POST /{dataset}/events`, `data[]`, customer-information parameters (em/ph/external_id hashed; fbc/fbp not hashed), normalization ((650)555-1212 → 16505551212).
- Google Data Manager API REST reference: audienceMembers ingest/remove/removeAll, events:ingest, requestStatus:retrieve; scope `https://www.googleapis.com/auth/datamanager`; limits of 10,000 members and 2,000 events per request; the normalization rules (Gmail dots and +tags, E.164).

## Unverified (for S13, against the live accounts)

1. The JSON shape of Meta's `operation_status` (the client reads a string, or an object's `description`, leniently).
2. The response body of Meta's `DELETE /{audience}/users` (the client checks only the HTTP status).
3. The Conversions API with the token in an `Authorization: Bearer` header rather than the `access_token` parameter Meta's pages show. Chosen so a frozen body carries no credential.
4. The success field `events_received` on a Conversions API answer. A 2xx is `accepted` only when it is an integer equal to the number of events in the frozen batch; any other value, or none, is `unknown` and is never resent (GD-2953).
5. That re-ingesting a held Google Customer Match member refreshes its added time, so a `removeAll` as of T keeps it. This is the premise of the design's replace. The fake models it that way.

## Logs and reasons

No console line and no `AdOutcome.reason` carries text from a caller's callback (the Google access-token source) or from a platform's error body (GD-2954; since v0.2.0 Google's error text goes only to the masked `detail` above, never to a reason or a log). Logs carry a fixed code and, for a thrown value, only its kind (a built-in error name, `Error subclass`, or a `typeof`). Reasons carry fixed codes: transport failures carry Node's error code (`meta_before_write:ECONNREFUSED`), a Google error status reaches a reason only when it is a gRPC canonical code, and a request-status error reason only when it is one of the 50 names of Google's published `ProcessingErrorReason` enum (`src/google/processing-error-reasons.ts`, read 2026-11-22; anything else, including a name Google adds later, is `UNRECOGNIZED_REASON`, with the outcome status unchanged; GD-2960). The token endpoint's `error` code reaches a thrown message only when it is an RFC 6749 §5.2 code, else `unrecognized_error`. The Drumbeat's moved audience code (`src/meta/drumbeat-audiences.ts`, `src/google/drumbeat-customer-match.ts`) keeps its live behaviour unchanged until the Drumbeat re-pin.

## Development

```bash
npm ci
npm test      # compile + typecheck tests + vitest against the fake (never a real platform)
```

`.husky/pre-push` runs the same gates as `rello-platform/tracking`: check-lockfile-ssh, hook reachability, tsc, compile, tests, and the tag-dist-gate on `v*` tags. Never push with `--no-verify`.
