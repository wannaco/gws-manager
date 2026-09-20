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

// Always returns a real JS array. Safe on null, undefined, "", a JSON string,
// a byte slice, or a genuine array.
function asArray(v) {
    if (v === null || v === undefined) return [];

    if (typeof v === "string") {
        return parseJsonArrayString(v) || [];
    }

    // byte slice first -- it also satisfies Array.isArray(), so it MUST be
    // tested before the plain-array branch
    if (looksLikeByteSlice(v)) {
        var decoded = parseJsonArrayString(String(v));
        if (decoded) return decoded;
        return [];
    }

    if (Array.isArray(v)) return v;

    // other array-like (Go slice of non-byte values, etc.)
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
    looksLikeByteSlice: looksLikeByteSlice,
    auditLog: auditLog
};

