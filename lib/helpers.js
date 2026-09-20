// =============================================================================
// GWS-Admin shared helpers module
// =============================================================================

var ENCRYPTION_KEY = $os.getenv("ENCRYPTION_KEY") || "";
var MAIL_USER      = $os.getenv("MAIL_USER") || "";
var MAIL_PASS      = $os.getenv("MAIL_PASS") || "";

// --- CORS helper (PB 0.39: use .set() not bracket notation) ---
function addCorsHeaders(e, methods) {
    methods = methods || "GET, POST, DELETE, OPTIONS";
    var hdr = e.response.header();
    try {
        // Same-origin only for a self-hosted tool: don't allow arbitrary sites to call the API.
        var origin = e.request.header("Origin");
        var allowed = $os.getenv("GWS_ALLOWED_ORIGIN") || "";
        if (allowed && origin === allowed) {
            hdr.set("Access-Control-Allow-Origin", origin);
            hdr.set("Vary", "Origin");
        } else if (!allowed && origin) {
            // No explicit origin configured: allow same-origin (no CORS header = browser blocks cross-origin reads)
            var host = e.request.host();
            if (origin && origin.indexOf("//" + host) !== -1) {
                hdr.set("Access-Control-Allow-Origin", origin);
            }
        }
        hdr.set("Access-Control-Allow-Methods", methods);
        hdr.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    } catch (_) {}
    if (e.request.method === "OPTIONS") { e.noContent(204); return true; }
    return false;
}

// --- Auth ---
function authUser(e) {
    if (e.auth) return { id: e.auth.id, email: e.auth.get("email") || "", isSuperuser: false };
    if (e.hasSuperuserAuth()) return { id: "admin", email: "admin", isSuperuser: true };
    e.json(401, { error: "unauthorized" }); return null;
}

// --- Single-tenant user config: reads from users table ---
// Replaces old multi-tenant getTenant. Each authenticated user is their own "tenant".
function getUserConfig(e, userId) {
    if (!userId) { e.json(400, { error: "userId required" }); return null; }
    try {
        var rec = $app.findRecordById("users", userId);
        if (!rec) { e.json(404, { error: "user_not_found" }); return null; }
        return rec;
    } catch (err) {
        e.json(404, { error: "user_not_found", message: err.message || String(err) });
        return null;
    }
}



// --- Encrypt / decrypt SA key (AES-256-GCM with ENCRYPTION_KEY) ---
function encryptSAKey(json) {
    var ekey = $os.getenv("ENCRYPTION_KEY") || "";
    if (!ekey) return json; // no key configured -> store as-is
    try {
        var raw = (typeof json === "string") ? json : JSON.stringify(json);
        // $security.encrypt needs a 16/24/32-byte key. A 64-char hex key
        // (openssl rand -hex 32) is not directly usable, and hex-decoding it to
        // raw bytes fails too: code points >127 become 2 bytes each when goja
        // converts the string to UTF-8 (32 chars -> 47 bytes). Derive a 32-char
        // ASCII key (32 bytes) deterministically instead.
        if (ekey.length !== 16 && ekey.length !== 24 && ekey.length !== 32) {
            ekey = String($security.sha256(ekey)).slice(0, 32);
        }
        return "gwsenc1:" + $security.encrypt(raw, ekey);
    } catch (err) {
        // Never leave the caller thinking the key was encrypted when it wasn't.
        console.error("GWS Admin: failed to encrypt service-account key, storing plaintext: " + (err && err.message || err));
        return json;
    }
}

function decryptSAKey(tenant) {
    var saKey = tenant.get("serviceAccountKey");
    if (!saKey) return null;

    // `serviceAccountKey` is a JSON field: PocketBase returns it as a byte
    // slice, not a string. asString() normalises every shape (see the note on
    // asArray for what a byte slice looks like in the JSVM).
    var raw = asString(saKey);

    // A JSON string round-trips quoted (e.g. "gwsenc1:..."), so unwrap it.
    if (raw.charAt(0) === '"') {
        try { raw = JSON.parse(raw); } catch (_) {}
    }

    // 1. Encrypted with $security.encrypt under ENCRYPTION_KEY.
    //    NOTE: PocketBase's JSVM has no WebCrypto (no crypto / btoa /
    //    TextEncoder / $app.newEncryptionCipher), so $security is the only
    //    available primitive.
    if (raw.indexOf("gwsenc1:") === 0) {
        try {
            var ekey = $os.getenv("ENCRYPTION_KEY") || "";
            if (!ekey) return null;
            // $security.decrypt needs a 16/24/32-byte key. A 64-char hex key
            // (openssl rand -hex 32) is not directly usable, and hex-decoding it
            // to raw bytes fails too: code points >127 become 2 bytes each when
            // goja converts the string to UTF-8 (32 chars -> 47 bytes). Derive a
            // 32-char ASCII key (32 bytes) deterministically instead.
            if (ekey.length !== 16 && ekey.length !== 24 && ekey.length !== 32) {
                ekey = String($security.sha256(ekey)).slice(0, 32);
            }
            var pt = $security.decrypt(raw.slice(8), ekey);
            var json = JSON.parse(pt);
            if (json && json.client_email && json.private_key) return json;
        } catch (_) { return null; }
        return null;
    }

    // 2. Plaintext service-account JSON (also covers keys stored before an
    //    ENCRYPTION_KEY was configured).
    try {
        var plain = JSON.parse(raw);
        if (plain && plain.client_email && plain.private_key) return plain;
    } catch (_) {}

    return null;
}

// --- Audience resolution (shared by the route and the scheduler) -------------
//
// `selector` shape:
//   { orgUnits: [], includeSubOUs: bool, groups: [], query: string,
//     manual: [], exclude: [] }
// `cfg` is the users record holding the service-account key; it is only needed
// when the selector names Google Groups (direct members only -- nested
// membership is deliberately not expanded).
function resolveAudience(selector, cfg) {
    selector = selector || {};
    var seen = {}, order = [];
    function add(em) {
        if (!em) return;
        var k = String(em).toLowerCase();
        if (!seen[k]) { seen[k] = true; order.push(String(em)); }
    }
    function esc(s) { return String(s).replace(/"/g, '\\"'); }

    // 1. Org units, from the local cache
    var ous = asArray(selector.orgUnits);
    if (ous.length) {
        var parts = [];
        for (var i = 0; i < ous.length; i++) {
            var ou = ous[i];
            if (selector.includeSubOUs && ou !== "/") {
                parts.push('(orgUnitPath = "' + esc(ou) + '" || orgUnitPath ~ "' + esc(ou) + '/")');
            } else {
                parts.push('orgUnitPath = "' + esc(ou) + '"');
            }
        }
        var recs = $app.findRecordsByFilter("domainUsers", parts.join(" || "), "+primaryEmail", 0, 0);
        for (var ri = 0; ri < recs.length; ri++) add(recs[ri].get("primaryEmail"));
    }

    // 2. Google Groups (Directory API, direct members only)
    var groups = asArray(selector.groups);
    if (groups.length) {
        var sa = cfg ? decryptSAKey(cfg) : null;
        if (!sa) { throw new Error("NO_SERVICE_ACCOUNT"); }
        var ae = cfg.get("adminEmail") || "";
        for (var gi = 0; gi < groups.length; gi++) {
            var ge = groups[gi], pt = "", pages = 0;
            do {
                var gurl = "https://admin.googleapis.com/admin/directory/v1/groups/" +
                           encodeURIComponent(ge) + "/members?maxResults=200";
                if (pt) gurl += "&pageToken=" + encodeURIComponent(pt);
                var gr = googleApiCall(sa, ae,
                    ["https://www.googleapis.com/auth/admin.directory.group.readonly"], gurl);
                var mb = asArray(gr && gr.members);
                for (var mi = 0; mi < mb.length; mi++) {
                    if (mb[mi].type === "USER" && mb[mi].email) add(mb[mi].email);
                }
                pt = (gr && gr.nextPageToken) || "";
                pages++;
            } while (pt && pages < 100);
        }
    }

    // 3. Free-text query
    if (selector.query) {
        var qq = esc(selector.query);
        var qr = $app.findRecordsByFilter("domainUsers",
            '(name ~ "' + qq + '" || primaryEmail ~ "' + qq + '")', "+primaryEmail", 0, 0);
        for (var qi = 0; qi < qr.length; qi++) add(qr[qi].get("primaryEmail"));
    }

    // 4. Explicit manual picks
    var manual = asArray(selector.manual);
    for (var mn = 0; mn < manual.length; mn++) add(manual[mn]);

    // 5. Exclusions
    var ex = {};
    var exclusions = asArray(selector.exclude);
    for (var ei = 0; ei < exclusions.length; ei++) ex[String(exclusions[ei]).toLowerCase()] = true;
    var out = [];
    for (var oi = 0; oi < order.length; oi++) {
        if (!ex[String(order[oi]).toLowerCase()]) out.push(order[oi]);
    }
    return out;
}

// --- Reading dates out of PocketBase ----------------------------------------
//
// An UNSET date field does not come back as "" or null: it is a Go zero-time
// OBJECT. It is truthy, it stringifies to "", and `new Date(it).getTime()` is
// NaN. So the obvious `field ? use(field) : fallback` picks the wrong branch and
// poisons any arithmetic with NaN.
//
// Always go through dateMs(): 0 means "not set".
function dateMs(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "string") {
        if (!v) return 0;
        var s = new Date(v).getTime();
        return (isNaN(s) || s <= 0) ? 0 : s;
    }
    if (typeof v === "number") return (isNaN(v) || v <= 0) ? 0 : v;
    // the zero-time object, or anything else Date cannot read
    var t;
    try { t = new Date(v).getTime(); } catch (_) { return 0; }
    if (isNaN(t) || t <= 0) return 0;
    // PocketBase's zero date is 0001-01-01; anything before 1970 is not real here
    if (new Date(t).getUTCFullYear() < 1970) return 0;
    return t;
}

// --- Schedule recurrence ----------------------------------------------------
//
// The JSVM has no Intl, so there is no IANA timezone support: a schedule stores
// the UTC offset the browser reported, and all arithmetic is done in
// "local = utc + offset" space. That is exact for zones without DST and drifts
// by an hour in zones with it. Documented, not hidden.
//
// freq: "once" | "daily" | "weekly" | "monthly" | "interval"

function parseHHMM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    var hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
}

// ms epoch -> {y,m,d,hh,mm,day,minutes} in the schedule's local time
function localParts(ms, offsetMin) {
    var d = new Date(ms + offsetMin * 60000);
    return {
        y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
        dow: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes(),
        minutes: d.getUTCHours() * 60 + d.getUTCMinutes()
    };
}

// local y/m/d + minutes-of-day -> ms epoch
function toEpoch(y, m, d, minutes, offsetMin) {
    return Date.UTC(y, m - 1, d, 0, 0, 0) + minutes * 60000 - offsetMin * 60000;
}

// Returns the next run time in ms, or 0 for "will never run again".
function nextRunAfter(sched, fromMs) {
    var off = parseInt(sched.tzOffsetMinutes, 10);
    if (isNaN(off)) off = 0;
    var freq = String(sched.freq || "daily");
    var mins = parseHHMM(sched.time);
    if (mins === null) mins = 9 * 60;   // default 09:00 local

    if (freq === "once") {
        var at = dateMs(sched.startsAt);
        return (at > fromMs) ? at : 0;
    }

    if (freq === "interval") {
        var every = parseInt(sched.intervalMinutes, 10);
        if (isNaN(every) || every < 1) every = 60;
        var base = dateMs(sched.lastRunAt);
        var anchor = base || dateMs(sched.startsAt) || fromMs;
        var nxt = anchor + every * 60000;
        if (nxt <= fromMs) {
            var steps = Math.ceil((fromMs - anchor) / (every * 60000));
            nxt = anchor + steps * every * 60000;
        }
        return nxt;
    }

    // walk forward day by day in LOCAL time -- simple, exact, and cheap for the
    // horizons involved (max ~2 months for monthly)
    var start = localParts(fromMs, off);
    for (var addDays = 0; addDays < 400; addDays++) {
        var probe = Date.UTC(start.y, start.m - 1, start.d) + addDays * 86400000;
        var p = new Date(probe);
        var py = p.getUTCFullYear(), pm = p.getUTCMonth() + 1, pd = p.getUTCDate();
        var pdow = p.getUTCDay();

        if (freq === "weekly") {
            var days = asArray(sched.weekdays);
            if (!days.length) days = [1, 2, 3, 4, 5];
            var hit = false;
            for (var wi = 0; wi < days.length; wi++) if (parseInt(days[wi], 10) === pdow) hit = true;
            if (!hit) continue;
        } else if (freq === "monthly") {
            var dom = parseInt(sched.dayOfMonth, 10);
            if (isNaN(dom) || dom < 1) dom = 1;
            if (dom > 28) {
                // clamp to the last day of THIS month so the 31st still fires in February
                var lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
                if (pd !== Math.min(dom, lastDay)) continue;
            } else if (pd !== dom) continue;
        }

        var cand = toEpoch(py, pm, pd, mins, off);
        if (cand > fromMs) return cand;
    }
    return 0;
}

// --- Bulk schedule payload -------------------------------------------------
// Lives here, not in the hooks file: PocketBase evaluates each route handler
// in its own scope, so module-level functions in main.pb.js are NOT visible
// inside them (documented gotcha -- 'schedulePayload is not defined').
function schedulePayload(rec) {
    return {
        id: rec.id,
        title: rec.get("title") || "",
        description: rec.get("description") || "",
        enabled: !!rec.get("enabled"),
        templateId: rec.get("templateId") || "",
        hasInlineHtml: !!asString(rec.get("htmlOverride")).trim(),
        selector: asObject(rec.get("selector")),
        freq: rec.get("freq") || "daily",
        time: rec.get("time") || "09:00",
        weekdays: asArray(rec.get("weekdays")),
        dayOfMonth: rec.get("dayOfMonth") || 1,
        intervalMinutes: rec.get("intervalMinutes") || 60,
        startsAt: rec.get("startsAt") || null,
        tzOffsetMinutes: rec.get("tzOffsetMinutes") || 0,
        timezone: rec.get("timezone") || "",
        nextRunAt: rec.get("nextRunAt") || null,
        lastRunAt: rec.get("lastRunAt") || null,
        lastStatus: rec.get("lastStatus") || "",
        lastError: rec.get("lastError") || "",
        lastJobId: rec.get("lastJobId") || "",
        lastRecipients: rec.get("lastRecipients") || 0,
        runCount: rec.get("runCount") || 0,
        successRuns: rec.get("successRuns") || 0,
        failedRuns: rec.get("failedRuns") || 0,
        appliedUsers: rec.get("appliedUsers") || 0,
        failedUsers: rec.get("failedUsers") || 0,
    };
}

// --- PocketBase json fields: always normalise before treating as a list ---
//
// PocketBase stores `json` fields as text and hands them back as a BYTE SLICE.
// In the JSVM that shows up as an array of byte values, so:
//
//     var e = record.get("emails");
//     Array.isArray(e)   -> true          <-- misleading
//     e.length           -> number of BYTES, not entries
//     e[0]               -> 91            <-- the ASCII code for "[", a number
//
// Looping `for (i = 0; i < e.length; i++)` therefore walks bytes and "processes"
// every character as a recipient. It does not throw; it just does the wrong
// thing ~20 times per address. Verified by probe on PB 0.39.0.
//
// String(byteSlice) DOES decode correctly (Go handles the UTF-8), so normalising
// is just: detect a byte slice, stringify it, JSON.parse the result.
// NOTE: diagnostic only. Do NOT branch on this -- [1,3,5] matches it.
function looksLikeByteSlice(v) {
    if (v === null || v === undefined) return false;
    if (typeof v.length !== "number" || v.length === 0) return false;
    var probe = Math.min(v.length, 16);
    for (var i = 0; i < probe; i++) {
        var el = v[i];
        if (typeof el !== "number") return false;
        if (el < 0 || el > 255 || (el % 1) !== 0) return false;
    }
    return true;
}

function parseJsonArrayString(s) {
    var str = String(s === null || s === undefined ? "" : s).trim();
    if (!str) return null;
    try {
        var parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed;
        return null;
    } catch (_) {
        return null;
    }
}

// Decode a json/text field to a plain string whatever PocketBase hands back.
// String(byteSlice) is the correct decode: Go performs the UTF-8 conversion.
// (The old hand-rolled String.fromCharCode loop in decryptSAKey was Latin-1 and
// would mangle any non-ASCII value.)
function asString(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    return String(v);
}

// Decode a json OBJECT field the same way as asArray. `selector` and similar
// fields come back as a byte slice, so `selector.orgUnits` would be undefined and
// the audience would silently resolve to nobody. Same detection trick: try the
// string interpretation, accept it only if it really parses to a plain object.
function asObject(v) {
    if (v === null || v === undefined) return {};
    if (typeof v === "string") {
        try {
            var p = JSON.parse(v);
            return (p && typeof p === "object" && !Array.isArray(p)) ? p : {};
        } catch (_) { return {}; }
    }
    var s = String(v);
    if (s && s !== "[object Object]") {
        try {
            var q = JSON.parse(s);
            if (q && typeof q === "object" && !Array.isArray(q)) return q;
        } catch (_) {}
    }
    if (typeof v === "object" && !Array.isArray(v)) return v;
    return {};
}

// Always returns a real JS array. Safe on null, undefined, "", a JSON string,
// a byte slice, or a genuine array.
function asArray(v) {
    if (v === null || v === undefined) return [];

    if (typeof v === "string") {
        return parseJsonArrayString(v) || [];
    }

    // A byte slice and a genuine array of small integers are INDISTINGUISHABLE by
    // value: [1,3,5] (weekdays!) satisfies looksLikeByteSlice. So do not classify
    // -- just attempt the string interpretation and accept it only if it really
    // produces an array.
    //
    //   byte slice of '["a@x.test"]'  -> String() = '["a@x.test"]'  -> parses  -> decode
    //   real array  ['a@x.test']      -> String() = 'a@x.test'      -> fails   -> use as-is
    //   real array  [1,3,5]           -> String() = '1,3,5'         -> fails   -> use as-is
    var decoded = parseJsonArrayString(String(v));
    if (decoded) return decoded;

    if (Array.isArray(v)) return v;

    // other array-like (a Go slice of non-byte values)
    try {
        if (typeof v.length === "number") {
            var out = [];
            for (var i = 0; i < v.length; i++) out.push(v[i]);
            return out;
        }
    } catch (_) {}
    return [];
}

// --- Google API via SA impersonation (RS256 signed by Go sidecar) ---
//
// Endpoints are overridable so the whole bulk path can be exercised against a
// local stand-in (see DEVELOPMENT.md). Defaults are the real services; nothing
// needs to be set in normal operation.
var GOOGLE_TOKEN_URL = $os.getenv("GWS_TOKEN_URL") || "https://oauth2.googleapis.com/token";
var SIGNER_URL = $os.getenv("GWS_SIGNER_URL") || "http://localhost:9999/sign";

// Optional base-URL rewrite for EVERY Google API call. Empty in normal
// operation, so nothing changes in production. Set it (e.g. to a local mock)
// to exercise the whole app -- bulk apply included -- without a Workspace
// domain.
var GOOGLE_API_BASE = $os.getenv("GWS_API_BASE") || "";

function rewriteApiUrl(u) {
    if (!GOOGLE_API_BASE) return u;
    var m = /^https?:\/\/[^\/]+(\/.*)$/.exec(u);
    if (!m) return u;
    return GOOGLE_API_BASE.replace(/\/$/, "") + m[1];
}
//
// Split into token + request so that a caller doing many calls for one user can
// fetch the token once and retry only the failing request. Both endpoints have
// their OWN quota: re-signing and re-fetching a token on every retry would burn
// the token quota while the API is already telling us to slow down.

// Retry policy.
//   429 (and 408) are safe to retry for ANY method: Google rejects the request
//   before acting on it, so a POST that 429s did not create anything.
//   5xx is only retried when the caller opts in (`retryOn5xx`), because a
//   retried POST may duplicate. The bulk signature apply uses PATCH, which is
//   idempotent, so it opts in.
var RETRY_BASE_MS = 500;
var RETRY_MAX_MS = 30000;
var RETRY_ATTEMPTS = 5;

function statusOf(err) {
    if (!err) return 0;
    if (typeof err.status === "number") return err.status;
    var m = /\((\d{3})\)/.exec(String(err.message || err));
    return m ? parseInt(m[1], 10) : 0;
}

// Gmail signals throttling in TWO different ways, and the docs are explicit
// that both mean "slow down and retry":
//
//   {
//     "error": { "errors": [{ "domain": "usageLimits",
//                             "reason": "userRateLimitExceeded",
//                             "message": "User Rate Limit Exceeded" }],
//                "code": 403, "message": "User Rate Limit Exceeded" } }
//
// i.e. the rate-limit responses are 403 -- NOT 429. Retrying only 429 would
// treat every Gmail throttle as a permanent failure. But most 403s are real
// permission problems, so we must key off the `reason`, never off the status.
// https://developers.google.com/workspace/gmail/api/guides/handle-errors
var RATE_LIMIT_REASONS = [
    "ratelimitexceeded",
    "userratelimitexceeded",
    "quotaexceeded",
    "dailylimitexceeded"
];

function isRateLimitError(err) {
    var st = statusOf(err);
    if (st === 429) return true;                 // some Google APIs do use 429
    if (st !== 403) return false;                // 403 needs the reason checked
    var reason = String(err.reason || "").toLowerCase();
    if (RATE_LIMIT_REASONS.indexOf(reason) > -1) return true;
    // fall back to the message text, and to a generic body scan
    var msg = String(err.message || "").toLowerCase();
    if (msg.indexOf("rate limit") > -1) return true;
    if (msg.indexOf("ratelimitexceeded") > -1) return true;
    if (msg.indexOf("quota") > -1 && msg.indexOf("exceed") > -1) return true;
    return false;
}

// Exponential backoff with full jitter. Without jitter, a chunk of users that
// all hit the same rate limit would retry in lockstep and trip it again.
function backoffDelay(attempt, baseMs, maxMs) {
    var d = (baseMs || RETRY_BASE_MS) * Math.pow(2, attempt);
    if (d > (maxMs || RETRY_MAX_MS)) d = maxMs || RETRY_MAX_MS;
    var jittered = Math.floor(Math.random() * d) + 250;
    return jittered;
}

// Runs fn(), retrying retryable failures. `opts.stats`, if given, accumulates
// counters the caller can surface to the user.
function withRetry(fn, opts) {
    opts = opts || {};
    var retries = (opts.retries === undefined) ? RETRY_ATTEMPTS : opts.retries;
    var baseMs = opts.baseDelayMs || RETRY_BASE_MS;
    var maxMs = opts.maxDelayMs || RETRY_MAX_MS;
    var retryOn5xx = !!opts.retryOn5xx;
    var stats = opts.stats || null;

    var attempt = 0;
    for (;;) {
        try {
            return fn();
        } catch (err) {
            var st = statusOf(err);
            var throttled = isRateLimitError(err);
            var retryable = throttled || (st === 408) || (retryOn5xx && st >= 500 && st < 600);
            if (!retryable || attempt >= retries) throw err;

            if (stats) {
                stats.retries = (stats.retries || 0) + 1;
                if (throttled) stats.rateLimited = (stats.rateLimited || 0) + 1;
            }
            // Retry-After is Google telling us exactly how long to wait. It must
            // NOT be clamped by our own exponential ceiling (maxMs) -- that is
            // only a bound on how far *our* backoff grows. Clamping it means
            // waiting 50ms when Google asked for 1s, and being throttled again.
            // It gets its own, larger ceiling so one absurd value cannot wedge
            // a whole tick.
            var wait, capped = false;
            if (err.retryAfterMs && err.retryAfterMs > 0) {
                wait = err.retryAfterMs;
                var raCap = opts.maxRetryAfterMs || 60000;
                if (wait > raCap) { wait = raCap; capped = true; }
            } else {
                wait = backoffDelay(attempt, baseMs, maxMs);
                if (wait > maxMs) { wait = maxMs; capped = true; }
            }
            if (stats) stats.throttledMs = (stats.throttledMs || 0) + wait;
            // Observability hook: lets a caller log/aggregate each backoff.
            if (typeof opts.onRetry === "function") {
                try {
                    opts.onRetry({ attempt: attempt + 1, status: st, waitMs: wait,
                        capped: capped, hadRetryAfter: !!(err.retryAfterMs > 0),
                        reason: err.reason || "", throttled: throttled });
                } catch (_) {}
            }
            if (typeof sleep === "function") { try { sleep(wait); } catch (_) {} }
            attempt++;
        }
    }
}

function googleAccessToken(saKey, userEmail, scopes) {
    return withRetry(function () {
        var now = Math.floor(Date.now() / 1000);
        var claim = { iss: saKey.client_email, sub: userEmail, scope: scopes.join(" "),
            aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };

        // Use Go sidecar for RS256 signing (PB 0.39 removed rsaSign)
        var signResp = $http.send({
            url: SIGNER_URL, method: "POST",
            body: JSON.stringify({ claim: claim, privateKey: saKey.private_key }),
            headers: { "Content-Type": "application/json" }, timeout: 10 });
        var jwt = signResp.json.signedJwt;
        if (!jwt) throw new Error("SIGNER_FAILED: " + (signResp.json.error || "unknown"));

        var tokenResp = $http.send({
            url: GOOGLE_TOKEN_URL, method: "POST",
            body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + encodeURIComponent(jwt),
            headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15 });
        var accessToken = tokenResp.json && tokenResp.json.access_token;
        if (!accessToken) {
            var e = new Error("GOOGLE_AUTH_FAILED (" + tokenResp.statusCode + ")");
            e.status = tokenResp.statusCode;
            throw e;
        }
        return accessToken;
    }, { retryOn5xx: true });   // issuing a token twice is harmless
}

function googleApiRequest(accessToken, apiUrl, method, body, opts) {
    method = method || "GET";
    return withRetry(function () {
        var resp = $http.send({
            url: rewriteApiUrl(apiUrl), method: method, body: body ? JSON.stringify(body) : "",
            headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" }, timeout: 30 });
        if (resp.statusCode >= 400) {
            var emsg = "";
            var reason = "";
            try {
                var eb = resp.json && resp.json.error;
                if (eb) {
                    emsg = eb.message || eb.code || "";
                    // Google puts the machine-readable cause in error.errors[].reason.
                    // This is the ONLY reliable way to tell a rate limit (403
                    // + reason=userRateLimitExceeded) from a real permission
                    // denial (403 + reason=forbidden).
                    if (eb.errors && eb.errors.length) {
                        reason = String(eb.errors[0].reason || "");
                        if (!emsg) emsg = eb.errors[0].message || "";
                    } else if (eb.status) {
                        reason = String(eb.status);
                    }
                }
            } catch (_) {}
            var e = new Error("GMAIL_API_ERROR (" + resp.statusCode + "): " + emsg);
            e.status = resp.statusCode;
            e.reason = reason;
            // Retry-After comes back as an array of strings from PB
            try {
                var ra = resp.headers && resp.headers["Retry-After"];
                if (ra) {
                    var v = Array.isArray(ra) ? ra[0] : ra;
                    var secs = parseInt(v, 10);
                    if (secs > 0) e.retryAfterMs = secs * 1000;
                }
            } catch (_) {}
            throw e;
        }
        return resp.json;
    }, opts);
}

// Resolve which send-as alias to write a signature to.
//
// Gmail exposes one or more send-as aliases per mailbox. The primary is usually
// the user's own address, but it need not be -- a user can have a custom
// "Send mail as" default, and the address we were handed may be an alias rather
// than the sendAs address at all. PATCHing users/{id}/settings/sendAs/{address}
// for an address that is not one of that user's aliases fails with
// 400 FAILED_PRECONDITION, which reads as "Precondition check failed" and tells
// you nothing.
//
// Preference order:
//   1. isDefault  && verificationStatus accepted
//   2. isPrimary  && verificationStatus accepted
//   3. any alias with verificationStatus accepted
//   4. isDefault  (unverified) -> raise a clear, named error
//   5. give up and return userEmail (previous behaviour)
function resolveSendAs(accessToken, userEmail) {
    var url = "https://gmail.googleapis.com/gmail/v1/users/" +
              encodeURIComponent(userEmail) + "/settings/sendAs";
    var list;
    try {
        list = googleApiRequest(accessToken, url, "GET");
    } catch (err) {
        // Cannot list aliases (permissions, transient). Keep the old behaviour
        // rather than failing the user outright.
        return userEmail;
    }
    var arr = asArray(list && list.sendAs);
    if (!arr.length) return userEmail;

    var accepted = function (a) {
        return !a.verificationStatus || a.verificationStatus === "accepted";
    };
    var pick = null, i;
    for (i = 0; i < arr.length; i++) if (arr[i].isDefault && accepted(arr[i])) { pick = arr[i]; break; }
    if (!pick) for (i = 0; i < arr.length; i++) if (arr[i].isPrimary && accepted(arr[i])) { pick = arr[i]; break; }
    if (!pick) for (i = 0; i < arr.length; i++) if (accepted(arr[i])) { pick = arr[i]; break; }
    if (!pick) {
        for (i = 0; i < arr.length; i++) if (arr[i].isDefault) { pick = arr[i]; break; }
        if (pick) {
            var e = new Error("SEND_AS_UNVERIFIED: cannot set a signature on " +
                (pick.sendAsEmail || userEmail) + " (verificationStatus=" +
                (pick.verificationStatus || "unknown") + ")");
            e.status = 400;
            e.reason = "sendAsUnverified";
            throw e;
        }
        pick = arr[0];
    }
    return pick.sendAsEmail || userEmail;
}

// Backwards-compatible single call. Existing routes keep working unchanged and
// silently gain 429 retry.
function googleApiCall(saKey, userEmail, scopes, apiUrl, method, body, opts) {
    var token = googleAccessToken(saKey, userEmail, scopes);
    return googleApiRequest(token, apiUrl, method, body, opts);
}

// --- Audit webhook ---
function auditLog(userId, action, actor, details) {
    try {
        var user = $app.findRecordById("users", userId);
        var webhookUrl = user.get("webhookUrl");
        if (!webhookUrl) return;
        var labels = { "domain.connect": "Domain Connected", "delegation.add": "Delegate Added",
            "delegation.remove": "Delegate Removed", "forwarding.createAddress": "Forwarding Address Created",
            "forwarding.updateAuto": "Auto-Forward Updated", "filter.create": "Filter Created",
            "filter.delete": "Filter Deleted", "vacation.update": "Vacation Updated",
            "calendar.acl.add": "Calendar Share Added", "calendar.acl.update": "Calendar Share Updated",
            "calendar.acl.remove": "Calendar Share Removed", "sendas.addAlias": "Send-As Alias Added",
            "sendas.addGroup": "Send-As Group Added", "sendas.remove": "Send-As Removed",
            "signature.update": "Signature Updated", "signature.bulkApply": "Signature Bulk Applied",
            "signatureTemplate.create": "Signature Template Created",
            "signatureTemplate.update": "Signature Template Updated",
            "signatureTemplate.delete": "Signature Template Deleted",
            "users.sync": "Users Synced" };
        var label = labels[action] || action;
        var dl = "";
        if (details) dl = Object.entries(details).filter(function(e) { var v = e[1]; return v !== undefined && v !== null; })
            .map(function(e) { return "> *" + e[0] + ":* " + e[1]; }).join("\n");
        $http.send({ url: webhookUrl, method: "POST",
            body: JSON.stringify({ text: "*GWS Admin \u2014 " + label + "*\nBy: " + actor + (dl ? "\n" + dl : "") }),
            headers: { "Content-Type": "application/json" }, timeout: 5 });
    } catch (_) {}
}

// --- Exports ---
module.exports = {
    ENCRYPTION_KEY: ENCRYPTION_KEY,
    MAIL_USER: MAIL_USER,
    MAIL_PASS: MAIL_PASS,
    addCorsHeaders: addCorsHeaders,
    authUser: authUser,
    getUserConfig: getUserConfig,
    encryptSAKey: encryptSAKey,
    decryptSAKey: decryptSAKey,
    googleApiCall: googleApiCall,
    GOOGLE_TOKEN_URL: GOOGLE_TOKEN_URL,
    SIGNER_URL: SIGNER_URL,
    GOOGLE_API_BASE: GOOGLE_API_BASE,
    rewriteApiUrl: rewriteApiUrl,
    googleAccessToken: googleAccessToken,
    googleApiRequest: googleApiRequest,
    withRetry: withRetry,
    statusOf: statusOf,
    isRateLimitError: isRateLimitError,
    resolveSendAs: resolveSendAs,
    asArray: asArray,
    asString: asString,
    asObject: asObject,
    dateMs: dateMs,
    resolveAudience: resolveAudience,
    schedulePayload: schedulePayload,
    nextRunAfter: nextRunAfter,
    parseHHMM: parseHHMM,
    localParts: localParts,
    looksLikeByteSlice: looksLikeByteSlice,
    auditLog: auditLog
};

