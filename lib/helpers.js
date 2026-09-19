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

    // `serviceAccountKey` is a JSON field, and PocketBase returns it as a byte
    // slice (an array of numbers) rather than a string — normalise it first.
    var raw;
    if (typeof saKey === "string") {
        raw = saKey;
    } else if (saKey && typeof saKey.length === "number") {
        raw = "";
        for (var i = 0; i < saKey.length; i++) raw += String.fromCharCode(saKey[i]);
    } else {
        raw = String(saKey);
    }

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

// --- Google API call via SA impersonation (RS256 signed by Go sidecar) ---
function googleApiCall(saKey, userEmail, scopes, apiUrl, method, body) {
    method = method || "GET";
    var now = Math.floor(Date.now() / 1000);
    var claim = { iss: saKey.client_email, sub: userEmail, scope: scopes.join(" "),
        aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };

    // Use Go sidecar for RS256 signing (PB 0.39 removed rsaSign)
    var signResp = $http.send({
        url: "http://localhost:9999/sign", method: "POST",
        body: JSON.stringify({ claim: claim, privateKey: saKey.private_key }),
        headers: { "Content-Type": "application/json" }, timeout: 10 });
    var jwt = signResp.json.signedJwt;
    if (!jwt) throw new Error("SIGNER_FAILED: " + (signResp.json.error || "unknown"));

    var tokenResp = $http.send({
        url: "https://oauth2.googleapis.com/token", method: "POST",
        body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + encodeURIComponent(jwt),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15 });
    var accessToken = tokenResp.json.access_token;
    if (!accessToken) throw new Error("GOOGLE_AUTH_FAILED");

    var resp = $http.send({
        url: apiUrl, method: method, body: body ? JSON.stringify(body) : "",
        headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" }, timeout: 30 });
    if (resp.statusCode >= 400) {
        var emsg = "";
        try { emsg = (resp.json && (resp.json.error && (resp.json.error.message || resp.json.error.code))) || ""; } catch (_) {}
        throw new Error("GMAIL_API_ERROR (" + resp.statusCode + "): " + emsg);
    }
    return resp.json;
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
    auditLog: auditLog
};

