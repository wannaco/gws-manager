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

---

# Addendum 5 — scheduled applies

## What it does

A schedule applies a signature on a recurrence: **daily**, **weekly** (chosen
days), **monthly** (chosen day), **once** at a specific date/time, or **every N
minutes**. Each schedule has a title, an optional description, an audience, a
signature, and execution counters.

## Design: a schedule makes a job, it does not apply anything itself

`gws-scheduler` (a minute tick) turns a due schedule into a normal `bulkJobs`
record. The existing `gws-bulk-worker` then drains it. So **batching, per-user
progress, retry with backoff, resume-after-restart, the dry-run guard and the
Bulk Jobs view are all reused** rather than reimplemented. A schedule is a
trigger plus a record of how it went.

Two behaviours worth knowing:

* A schedule will **not** queue a new job while its previous job is still
  running (`lastStatus: "skipped"`, `previous run is still in progress`).
  Otherwise a long run on a one-minute cadence would pile up jobs behind it.
* Several schedules due in the same minute queue together, but the worker
  processes **one job per tick** — so they apply one after another, roughly a
  minute apart, not simultaneously. That is deliberate: concurrent runs would
  double the load on the same Google quota.

## Execution counters

Per schedule: `runCount`, `successRuns`, `failedRuns`, `appliedUsers`,
`failedUsers`, plus `lastStatus` / `lastError` / `lastJobId` / `lastRecipients`.
The worker updates them when a job finishes, so the counts reflect what actually
happened to mailboxes, not merely that a job was queued. Each schedule also has
a **History** panel listing its recent runs.

## ⚠️ Timezone: honest limitation

The JSVM has **no `Intl`**, so IANA zones cannot be resolved server-side. A
schedule stores the **UTC offset the browser reported** (`tzOffsetMinutes`) and
all recurrence maths is done in `local = utc + offset`. `timezone` is stored for
display only.

* Exact for zones **without** DST (including the configured one, UTC-06:00).
* An hour out, in season, for zones **with** DST.

This is stated in the UI (the editor shows the resolved offset) and here, rather
than being hidden. Fixing it properly means resolving the zone on the client and
sending a concrete UTC instant per occurrence — a larger change.

## Recurrence is computed in ONE place

`nextRunAfter()` in `lib/helpers.js` is used by the create/update route, the
cron, and (for preview) the UI. The UI's preview is a mirror, and the server
remains the authority — but there is only one implementation of the rule, since
every defect this session came from logic existing twice and being fixed once.

## Three platform traps hit while building this

1. **`{:placeholder}` supplies its own quoting.** `scheduleId = "{:sid}"` throws
   `invalid filter expression`; `scheduleId = {:sid}` is correct.
2. **An unset PocketBase date field is a truthy Go zero-time object.** It
   stringifies to `""` and `new Date(it).getTime()` is `NaN`, so
   `field ? use(field) : fallback` picks the wrong branch and poisons the maths
   with NaN. Always go through `dateMs()` — 0 means "not set".
3. **`asArray` classified by VALUE and that was wrong.** `[1,3,5]` (weekdays)
   satisfies `looksLikeByteSlice` because its elements are integers 0–255, so the
   weekday list decoded to `[]` and weekly schedules silently ran Mon–Fri. A byte
   slice and an array of small integers are **indistinguishable by value**;
   `asArray` now attempts the string interpretation first and accepts it only if
   it really parses. `looksLikeByteSlice` is now diagnostic only.

## Verified

| Suite | Result |
|---|---|
| recurrence unit (parse, daily, weekly, monthly incl. the 31st clamping to Feb 28, once, interval, offsets, garbage) | 38/38 |
| scheduler end to end (CRUD, validation, toggle, runNow, cron firing by itself, empty-audience skip, delete, counters) | 26/26 |
| Schedules UI (grouped sidebar, page, editor, field visibility per frequency, preview, validation, audience picker, save, history) | 32/32 |
| bulk regression (after the asArray change) | 22/22 |
| inline html / template delete | 12/12 |

## UI consistency pass

Shared classes in `styles/index.css` (`.gws-page-head`, `.gws-panel`, `.gws-row`,
`.gws-field`, `.gws-label`, `.gws-daychip`, `.gws-note`, `.gws-nav-head`), and the
sidebar grouped into **Users / Signatures / Settings**. Deliberately CSS-only:
Tailwind and DaisyUI load from CDNs with **no build step**, so `sm:`/`lg:`
prefixes do not work — anything responsive is a plain media query.

---

## Defect 14 — the recipient picker was unclickable from the schedule editor

The schedule editor opens the shared recipient picker as a nested dialog. Both
were `fixed inset-0 z-50`, and **at equal z-index the element later in the DOM
wins** — the editor comes after the picker, so it painted over it. The picker was
visible (its container was not `hidden`) but nothing in it could be clicked.

Fixed with an explicit ladder in `styles/index.css`, lowest first:

```css
#schedule-editor { z-index: 100; }
#audience-overlay { z-index: 120; }
#modal-overlay   { z-index: 130; }
```

**Why the test suite missed it:** every assertion checked a `hidden` class. An
element can be un-hidden and still be underneath something. The check that
catches this is `document.elementFromPoint(x, y)` at the place you would click,
asserting which element owns that point — now in `test_overlay_stack.py`, along
with a real click on a control inside the picker.

---

## Defect 15 — picking a template in the schedule editor loaded nothing

The template `<select>` had **no `onchange` handler at all**, so choosing a
template did not load its content — you could not see what would be applied. The
user-level page has a separate "Apply" button that does this; the schedule editor
had no equivalent, so a schedule's signature was invisible until it ran.

There was also a **silent-discard trap** underneath it: `saveSchedule()` sent
`html: ''` whenever a `templateId` was set, so anything typed into the editor was
thrown away with no warning. Two possible content sources, no visible rule.

Fixed by making the rule explicit:

* picking a template **loads its content into the editor** on the spot (plus a
  **Load** button to re-load it after editing);
* a **"Follow this template"** checkbox decides which source wins:
  * **off (default)** — the editor is the content; a snapshot is stored, so later
    edits to the template do **not** change this schedule;
  * **on** — the schedule stores the template id and applies the template's
    current content each run; the editor is **visibly dimmed and non-interactive**,
    so nothing is silently ignored;
* a line under the picker states which of the two is in effect, in words;
* saving with an empty editor and a template selected now explains the choice
  instead of discarding content.

Reopening a schedule restores its mode: an inline-html schedule opens as a
snapshot with the box unticked, a template-id schedule opens following it with the
box ticked and the editor dimmed.

## Verified

`test_template_load.py` — 20 checks: the dropdown is wired, content loads, the
note changes with the box, the editor dims when following, an empty editor warns
instead of dropping content, snapshot mode stores html with no templateId, live
mode stores the templateId with no html, and both reopen in the right mode.
Regression: overlay stack 13/13, Schedules UI 32/32.
