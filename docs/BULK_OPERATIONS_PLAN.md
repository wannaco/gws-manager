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

## Defect 5 — one stalled job blocked the entire queue

The worker asked for `findRecordsByFilter(..., limit 1, ...)`, took `jobs[0]`,
and **returned early if that job was locked**. So a single job that could not
progress held the queue indefinitely. Reproduced: a job whose owner user had been
deleted stayed `status="running"` while an unrelated, healthy job behind it sat
at `done=0` for 5 consecutive ticks (150s).

Three changes:

1. **Pick the oldest *runnable* job**, not the oldest job — iterate the running
   jobs and skip any that is currently locked.
2. **Fail a job that can never run.** A missing owner user now fails the job
   immediately (`lastError: "owner user no longer exists"`) instead of throwing
   on every tick.
3. **Stall detection.** A tick that completes without advancing `done` increments
   `stallCount`; any progress resets it. At `STALL_LIMIT` (3) consecutive
   unproductive ticks the job is failed with
   `"stalled: no progress in 3 consecutive ticks"`.
4. **Fairness.** `stallCount > 0` also means "was unproductive last tick", and
   the selection prefers jobs that were productive. Without this the oldest job
   was still chosen every tick — it was *retried*, but jobs behind it still got
   nothing. Now a stalling job yields to healthy ones and is only retried once
   the healthy ones are done.

Verified after the fix, with a permanently-stalling job ahead of a healthy one:

```
t+128s   A stall=1  running   |  B done=30  done      <- B ran, not starved
t+256s   A stall=3  FAILED    |  B done=30  done      <- stall detector fired
```

Serial processing is retained **deliberately**: each user costs several HTTP
calls, and two concurrent runs would double the load on the same per-project
Google quota and cause more throttling for both. The fix was fairness, not
concurrency.

---

# Addendum 2 — the jobs view

## What was missing

There was **no way to enumerate bulk jobs**. `/gws/bulk/status` requires an id,
and the UI kept that id in a page variable (`window._bulkJob`), so:

- reloading the tab **lost the job permanently** — you could not find out whether
  a 5,000-user run had finished or died halfway;
- a job started by one admin was invisible to every other admin;
- there was no history, no queue, and no way to see a second queued job at all.

The API also returned eight diagnostic fields (`etaMs`, `avgMsPerUser`,
`retries`, `rateLimited`, `throttledMs`, `stallCount`, `lockedAt`, `dryRun`) that
the UI displayed **none** of — so "Google is rate-limiting us" and "it is slow"
looked identical.

## What was added

| Piece | Detail |
|---|---|
| `GET /gws/bulk/jobs` | Lists jobs, newest first. `limit` (max 100) + `offset`, returns `total`. Per row: status, done/total, failures, dry-run flag, who started it, timestamps, `pct`, `etaMs`, `retries`, `rateLimited`, `throttledMs`, `stallCount`, `lastError`. |
| `GET /gws/bulk/failures` | Paged failures (`limit` max 500). `/gws/bulk/status` truncates at 100, which silently hid the rest of a bad run. |
| **Bulk jobs panel** | Always visible in the Bulk Signatures section: every job, its badges, its diagnostics, and a **Refresh** button. |
| **Survives reload** | The job id is kept in `localStorage` (`gws.lastBulkJob`), so a reload re-attaches the progress bar instead of orphaning the run. |
| **Diagnostics surfaced** | The progress line now reads e.g. `142 of 300 applied · 3 failed · ~2m 10s left · throttled by Google 4x · waited 12s`. |
| **Full failure list** | "View failures" pages through everything rather than showing the first 100. |

## Access control — deliberate, and worth revisiting

`users.role` (`owner`/`admin`/`member`) exists in the schema but is **not
enforced anywhere in this build**; it is only used for Calendar ACLs. These
routes follow the same model as every other route: any authenticated user sees
the jobs. The route carries a comment saying so, so that if role enforcement is
added later this does not silently become the hole.

## Not done

- The list loads the newest 25 with a "showing N of M" hint; there is no
  pagination control in the UI yet (the endpoint supports it).
- No live auto-refresh of the list itself — it refreshes while a watched job is
  polling, and on demand via Refresh.

## Verified

- **12/12 endpoint checks**: auth required, `limit` clamped to 100, garbage
  params fall back, unknown id 404s, missing id 400s, a real job appears with
  every field the UI needs, `createdBy` resolves to an email.
- **16/16 browser checks**: the panel renders a real row with a status badge,
  the placeholder is replaced, `localStorage` survives a reload, a bad job id
  shows an error rather than throwing, and `/gws/bulk/*` never returns 4xx/5xx.

One test fix worth recording: the first browser run "passed" against a login that
landed on the **Setup Your Domain** page, because the scratch user had no
`domain` set, so `get-tenant` returned null and the dashboard never rendered.
The assertions passed because the markup was in the DOM anyway. The seed now
sets `users.domain`.

---

# Addendum 3 — blank templates and GMAIL 400 failedPrecondition

Two user-reported failures. Both reproduced, both traced to a specific line.

## Defect 6 — "Save as Template" wrote a blank template

The button lives on a **user's Signature tab** (`user-tabs.js`), but the handler
it called read the **Bulk Signatures** editor:

```js
// bulk.js -- the ONLY caller is on the user's Signature tab
const html = window._bulkEditor ? cleanEditorOutput(window._bulkEditor) : '';
```

`window._bulkEditor` only exists after the Bulk Signatures section has been
opened. Reach the Signature tab without doing that — the normal path — and it is
`undefined`, so `html` was `''` and a **blank template row was stored**, with no
error shown. If the bulk editor *had* been opened, it saved whatever was in
there instead: the wrong signature, silently.

Fixed: the modal records which editor to read, the per-user tab passes
`'sig'`, and the handler uses that user's editor (`getSig()`).

There is now also an emptiness guard. It cannot be a plain `.trim()` check,
because GrapesJS always emits its canvas CSS — an "empty" editor still returns
`<style>* { box-sizing: border-box; }</style>`, which passes `.trim()`. The guard
strips style/script/comments and looks for real text or media.

## Defect 7 — GMAIL_API_ERROR (400): Precondition check failed.

The bulk worker PATCHed the user's own address as the send-as alias:

```js
"/settings/sendAs/" + encodeURIComponent(email)      // the user's address
```

That is only valid when the user's address happens to BE one of their send-as
aliases. If their DEFAULT alias is something else, or their address is not in the
alias list at all, Gmail answers **400 FAILED_PRECONDITION** — which surfaces as
"Precondition check failed" and explains nothing.

The single-user path already did this correctly (`/gws/send-as` → pick
`isDefault || isPrimary` → use that address). The bulk worker never did.

Fixed: `resolveSendAs()` lists the aliases and picks, in order:
`isDefault && accepted` → `isPrimary && accepted` → any `accepted` →
unverified default (raises a named `sendAsUnverified` error) → give up and return
the user's address (previous behaviour, so nothing regresses).

Verified end to end against a mock that reproduces Gmail's behaviour: patching
the user's own address returns 400, patching the alias returns 200. The worker
listed the aliases and patched `alias@example.test` — **3/3 applied, 0 failed**.
Under the old code that same job 400s on every user.

## Defect 8 — a blank template would have wiped every signature

Follow-on from defect 6: the blank rows it created are still in the database, and
applying one would set an EMPTY signature on every recipient — clearing their
existing signature. The worker now refuses an effectively-empty template and
fails the job with `"template is empty - refusing to apply it (it would clear
every signature)"`. Verified: `done=0` and **zero Gmail writes**.

> **Action for existing installs:** the blank templates created before this fix
> are still in the `signatureTemplates` collection. They can be deleted safely —
> they are now inert (the worker refuses them), but they clutter the picker.

## Verified

| Suite | Result |
|---|---|
| `resolveSendAs` unit (alias-default, alias-only, unverified, list-failure) | 6/6 |
| send-as end-to-end through the real worker | 5/5 |
| blank-template browser test (right editor + guard) | 11/11 |
| blank template refused, no Gmail write | 4/4 |
| full bulk regression | 22/22 |

---

# Addendum 4 — per-user apply, BulkTemp spam, template deletion, jobs page

Four items from real use.

## Defect 9 — two more send-as writes still assumed the user's own address

The send-as fix in addendum 3 only covered the **new** bulk worker. Two older
paths made the same assumption:

```js
// per-user "Save" on a user's Signature tab
"/settings/sendAs/" + encodeURIComponent(te)        // te = b.sendAsEmail
// legacy bulkApply branch
"/settings/sendAs/" + encodeURIComponent(email)     // the user's own address
```

Both produce **400 FAILED_PRECONDITION** whenever the address is not one of that
user's aliases. The per-user panel reads its alias list from `/gws/send-as`, and
that call is wrapped in `try {} catch(e) {}` on the client — so if it fails
(permissions, a transient error) the UI silently falls back to `sendAsEmail =
the user's address`, and Save then 400s. That is "applying to individual users is
impossible".

Both now call `resolveSendAs()` server-side and no longer trust the client's
pick, falling back to it only if the lookup itself fails. `sendAsUnverified`
surfaces as a named error instead of a bare 400.

## Defect 10 — BulkTemp template created on every run

`executeBulkApply()` POSTed the editor content as a **new template named
"BulkTemp" on every single run**, purely so the worker had an id to read. That is
where the pile of BulkTemp rows came from.

Jobs now carry the HTML themselves (`bulkJobs.htmlOverride`, new migration
`1786000040`). `templateId` is still accepted so applying a saved template works,
but it is no longer required. Verified: an inline-HTML job creates **zero**
template rows and applies correctly.

## Defect 11 — no way to delete a stored template

The API supported `action=delete`; nothing in the UI called it, so templates
could only ever accumulate. There is now a **Delete** button beside both template
pickers (Bulk Signatures and a user's Signature tab), with confirmation.

## Defect 12 — the job queue cluttered the compose page

The queue table sat under the editor. It now has **its own page** with a sidebar
entry (**Bulk Jobs**), showing every run with status, counts, failures, and
per-job diagnostics.

- The compose page keeps only the **current job's** progress bar and a link to
  Bulk Jobs.
- `navTo()` knows the new section; `onBulkJobsSectionShown()` loads the list.
- The sidebar is **inline in `index.html`** — `components/dashboard-sidebar.html`
  is dead code that nothing references. The item was added to both so they cannot
  disagree, but that file should be deleted.

## Two process notes

- An unbalanced `</div>` was introduced while moving the jobs card (four
  consecutive closes left from the removed card). Browsers auto-recover, so every
  assertion still passed — the file was only caught by a depth walk that went
  negative. Compare `<div>`/`</div>` counts against `HEAD` after HTML surgery.
- Two suites were run **concurrently against the same PocketBase and the same
  mock**. One of them SIGKILLs the server mid-run, which made the other report 3
  bogus failures. Run them sequentially.

## Verified

| Suite | Result |
|---|---|
| inline html job, no template row | 12/12 |
| UI split (sidebar, pages, delete buttons, per-user tab) | 22/22 |
| send-as end-to-end | 5/5 |
| full bulk regression | 22/22 |
