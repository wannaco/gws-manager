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
