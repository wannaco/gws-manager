# Bulk Operations — Targeting & Chunked Apply

**Branch:** `feature/bulk-targeting`
**Status:** in progress
**Scope:** make Bulk Signature Apply usable on large Google Workspace domains.

## The problem

Today's bulk apply is a flat list of checkboxes rendered from `domainUsers` and a
synchronous loop:

```js
// frontend/js/bulk.js
domainUsers.map(u => `<input type="checkbox" value="${u.email}">`)

// hooks/main.pb.js — POST /gws/signature { action: "bulkApply" }
for (var i = 0; i < b.userEmails.length; i++) { /* one Google API call each */ }
```

Two independent failures at scale:

1. **Selection** — every user is rendered as a checkbox, with no OU tree, no groups,
   no search, no "select all matching". Unusable past a few hundred users.
2. **Application** — one HTTP request performs N sequential Google calls. Times out
   long before finishing a real domain, and a failure mid-way loses all progress.

## Explicit non-goals

- **Nested / derived group membership is NOT supported.** `/gws/group-members` returns
  direct members only, and that is the documented behaviour. A group containing
  sub-groups will NOT expand to the sub-groups' members. This must be stated in the UI
  and the user guide — silently applying to fewer people than expected is worse than
  refusing.

## Design

### Selection (Phase 1)

All targeting resolves against the local `domainUsers` cache — no per-user Directory
calls, so counting a 20k-user domain is a SQL query, not 20k API calls.

| Endpoint | Purpose |
|---|---|
| `GET /gws/user-cache` | **fix**: accept `limit`/`offset`, return `total` |
| `GET /gws/org-units` | distinct `orgUnitPath` as a tree, with per-node counts |
| `GET /gws/group-members` | **fix**: follow `nextPageToken` (currently hard-capped at 500) |
| `POST /gws/audience/resolve` | selector → `{ emails[], count }` |

Selector shape:

```json
{
  "orgUnits": ["/Sales", "/Sales/EMEA"],
  "includeSubOUs": true,
  "groups": ["sales@example.com"],
  "query": "marroquin",
  "exclude": ["ceo@example.com"]
}
```

Union of the parts, minus `exclude`. Manual add/remove on top, so targeting can be
mixed with hand-picked people.

### Application (Phase 2)

Modelled on the existing gw-mailbox cron pattern (`cronAdd("gw-mail-poll-sync", "* * * * *", …)`)
rather than a new worker process. A `bulkJobs` record is the queue entry; a
minute-tick cron drains it one chunk at a time.

| Piece | Behaviour |
|---|---|
| `bulkJobs` collection | `status`, `selector`, `emails[]`, `total`, `done`, `failed[]`, `chunkSize`, `createdBy` |
| `POST /gws/bulk/start` | creates the job, resolves the audience, **returns immediately** with `jobId` |
| `cronAdd("gws-bulk-worker", "* * * * *")` | takes `status="running"` jobs, applies **one chunk (25)**, updates progress, marks `done` |
| `GET /gws/bulk/status?id=` | progress + failures, for the UI to poll |
| `POST /gws/bulk/retry` | re-queues only the failed emails |

**Resumability is free.** A restart mid-run just means the next tick resumes — the
record holds the position. No queue library, no separate worker process.

**Rate limiting is required.** Sequential calls with no throttle will 429. Chunk size
25/tick is the primary throttle; transient 429/5xx retry with backoff before a user is
recorded as failed.

### UI

Audience builder replacing the checkbox wall:
- OU tree with an "include sub-OUs" toggle
- searchable group picker (**with the no-nested-groups caveat shown inline**)
- free-text filter
- live "N recipients" counter
- preview list before applying
- after apply: progress bar, live failure list, retry-failed

## Sequencing

1. `/gws/user-cache` paging + `/gws/org-units` — unblocks everything else
2. Audience builder UI against those (selection works; apply still one-shot)
3. `bulkJobs` + cron worker + status polling
4. `/gws/group-members` paging
5. Docs: no-nested-groups limitation

## Testing

PocketBase 0.39.0 is available locally; test against a scratch instance with a seeded
`domainUsers` cache (a few hundred synthetic users across several OUs), so:
- OU filtering and sub-OU inclusion are exercised
- chunking crosses a chunk boundary
- a forced failure mid-run is recorded and retryable
- a restart mid-run resumes rather than restarting or losing the job

---

# Addendum — what was actually wrong, and how it is tested

Everything below was found by **running the worker**, not by reading it. The
first version of this feature was broken in ways that no amount of code review
would have caught, because none of the failures were loud.

## Defect 1 — json fields come back as a byte slice, not an array

This one meant **bulk apply never worked at all**, not just at scale.

PocketBase stores `json` fields as text and hands them back as a **byte slice**.
In the JSVM that is an array of byte *values*, and — critically —
`Array.isArray()` on it returns **true**:

```
record.get("emails")            ->  object, Array.isArray() === true
record.get("emails").length     ->  70          (bytes, not entries)
record.get("emails")[0]         ->  91          ('[' — a NUMBER)
String(record.get("emails"))    ->  '["a@x.test","b@x.test","c@x.test"]'
```

So `for (i = 0; i < emails.length; i++)` walked **bytes**, and `emails[i]` was a
number. A 20-address job recorded `done = 461` — exactly the character count of
the JSON — and reported every address as failed. Nothing threw.

`lib/helpers.js` already contained a hand-rolled workaround for precisely this
behaviour inside `decryptSAKey`, with this comment:

```js
// `serviceAccountKey` is a JSON field, and PocketBase returns it as a byte
// slice (an array of numbers) rather than a string — normalise it first.
```

It had simply never been generalised. There are now `asArray()` / `asString()`
helpers, `decryptSAKey` uses them (which also fixes its Latin-1 handling of
non-ASCII values), and every place that reads a json field as a list goes
through them.

## Defect 2 — Gmail signals rate limits with 403, not 429

From Google's own error-handling documentation:

```
rateLimitExceeded      ->  "code": 403
userRateLimitExceeded  ->  "code": 403
   "Use exponential backoff to retry the request."
```

Retrying only on 429 therefore classified **every Gmail throttle as a permanent
failure**. The retry decision now keys off `error.errors[].reason` and never the
status code alone, so `403 + forbidden` (a genuine permission error) is still
not retried, while `403 + userRateLimitExceeded` is.

## Defect 3 — there was no retry or backoff at all

Added:

| Behaviour | Detail |
|---|---|
| Backoff | exponential, full jitter, base 500ms, cap 30s |
| `Retry-After` | honoured, and **not** clamped by our own backoff ceiling |
| 429 / 403-rate-limit | always retried |
| 5xx | retried only when the caller opts in (protects non-idempotent methods) |
| 400 / 403-forbidden | never retried |
| Counters | `retries`, `rateLimited`, `throttledMs` recorded per job |

## Defect 4 — throughput was capped at `chunkSize` users per minute

Measured: **120 users in 75s** (≈120ms/user). The old fixed-chunk loop would
have taken ~288s, and a 50,000-user domain ~33 hours *regardless of how fast
Google answered*. The worker now runs to a **time budget** (50s of a 60s tick),
and saves progress **after every user** so a restart resumes on the exact user
it stopped on. A per-job `lockedAt` stops a slow tick being re-entered and
re-applying the same users.

## Added: dry run

`dryRun: true` resolves and renders the entire audience and calls nothing.
Deliberately does not require a service account, so an audience can be previewed
before Google is wired up. This is the answer to "how do I know what it will do
to a 5,000-person domain" — you do not need a 5,000-person domain to find out
whether the machinery is right.

## How to test this without a Workspace domain

The signer, the OAuth token endpoint and the Google API base are all
env-overridable:

| Variable | Default | Purpose |
|---|---|---|
| `GWS_SIGNER_URL` | `http://localhost:9999/sign` | Go RS256 signer |
| `GWS_TOKEN_URL` | `https://oauth2.googleapis.com/token` | OAuth token exchange |
| `GWS_API_BASE` | *(empty)* | rewrites every Google API call to a local mock |

All three default to the real values, so **production behaviour is unchanged**
and that is asserted in the tests. With them set, a stand-in server that speaks
the Gmail error shapes (including `Retry-After`) exercises the whole path.

Run order matters: the worker is `cronAdd(..., "* * * * *")`, so a tick takes up
to 60s.

## Known gap

The worker processes **one job per tick, oldest first**. A job that can never
progress would therefore block the queue behind it. There is a lock timeout
(4 minutes) that frees the *lock*, but no stall detector that fails the *job*.
Worth adding before this is sold to anyone with several admins.
