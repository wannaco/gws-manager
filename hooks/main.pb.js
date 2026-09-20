/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// GWS-Admin — Single-tenant PocketBase hooks
// Each authenticated user is their own config (users table).
// =============================================================================

// NOTE: PocketBase's JSVM does not expose module-level bindings (var/let/const)
// inside handler closures — they read as "not defined" at request time. Always
// resolve paths with the built-in __hooks global instead of a module-level var,
// or every route fails with PocketBase's generic 400.
var h = require(__hooks + "/../lib/helpers.js");

// ==================== SIMPLE TEST ROUTES ====================
routerAdd("GET", "/gws/ping2", (e) => { e.json(200, { ok: true, msg: "no-cors" }); });

routerAdd("GET", "/gws/ping", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    e.json(200, { ok: true, pong: Date.now() });
});

// ==================== CONFIG / SETUP ====================

// Get current user's config
routerAdd("GET", "/gws/get-tenant", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    try {
        var rec = $app.findRecordById("users", u.id);
        e.json(200, {
            ok: true,
            tenant: {
                id: rec.id,
                domain: rec.get("domain") || "",
                adminEmail: rec.get("adminEmail") || "",
                gcpProjectId: rec.get("gcpProjectId") || "",
                webhookUrl: rec.get("webhookUrl") || "",
                hasServiceAccountKey: h.decryptSAKey(rec) !== null,
            }
        });
    } catch (_) {
        e.json(200, { ok: true, tenant: null });
    }
});

// Setup / onboarding (saves domain + adminEmail + optional SA key)
routerAdd("POST", "/gws/setup", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    try {
        var coll = $app.findCollectionByNameOrId("users");
        var rec;
        try { rec = $app.findRecordById("users", u.id); } catch (_) {
            rec = new Record(coll, {id: u.id});
        }
        if (b.domain) rec.set("domain", b.domain);
        if (b.adminEmail) rec.set("adminEmail", b.adminEmail);
        if (b.serviceAccountKey) rec.set("serviceAccountKey", h.encryptSAKey(b.serviceAccountKey));
        $app.save(rec);
        e.json(200, { ok: true, tenantId: rec.id, domain: b.domain || "" });
    } catch (err) {
        e.json(500, { error: "internal_error", message: err.message || String(err) });
    }
});

// Save domain config (SA key etc) — saves first, tests connection after
routerAdd("POST", "/gws/save-domain-config", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var dom = b.domain, ae = b.adminEmail, sak = b.serviceAccountKey;
    if (!dom || !ae || !sak) { e.json(400, { error: "All fields required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    if (!sak.client_email || !sak.private_key) { e.json(400, { error: "Invalid service account key" }); return; }
    // Save first, test later (test is informational, not a blocker)
    var coll = $app.findCollectionByNameOrId("users"); var rec = $app.findRecordById(coll, u.id);
    rec.set("domain", dom); rec.set("adminEmail", ae); rec.set("serviceAccountKey", h.encryptSAKey(sak)); $app.save(rec);
    h.auditLog(u.id, "domain.connect", u.email || u.id, { domain: dom, adminEmail: ae });
    var testOk = false, testError = "";
    try {
        h.googleApiCall(sak, ae, ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
            "https://admin.googleapis.com/admin/directory/v1/users?domain=" + encodeURIComponent(dom) + "&maxResults=1");
        testOk = true;
    } catch (err) { testError = err.message || String(err); }
    e.json(200, { ok: true, domain: dom, adminEmail: ae, connectionTest: testOk, connectionError: testError || null });
});

// ==================== GWS OPERATIONS ====================

// List domain users — reads from local cache if available, falls back to Directory API
routerAdd("GET", "/gws/list-users", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var q = e.request.url.query().get("query") || "";
    var ouq = e.request.url.query().get("orgUnit") || "";
    var subOUs = e.request.url.query().get("includeSubOUs") === "1";
    var limit = parseInt(e.request.url.query().get("limit") || "500");
    if (isNaN(limit) || limit <= 0) limit = 500;
    if (limit > 2000) limit = 2000;
    var offset = parseInt(e.request.url.query().get("offset") || "0");
    if (isNaN(offset) || offset < 0) offset = 0;
    // Try local cache first
    try {
        var esc = function(s) { return String(s).replace(/"/g, '\\"'); };
        var parts = [];
        if (q) parts.push('(name ~ "' + esc(q) + '" || primaryEmail ~ "' + esc(q) + '")');
        if (ouq) {
            // exact OU, or that OU plus everything beneath it when includeSubOUs=1
            if (subOUs && ouq !== "/") {
                parts.push('(orgUnitPath = "' + esc(ouq) + '" || orgUnitPath ~ "' + esc(ouq) + '/")');
            } else {
                parts.push('orgUnitPath = "' + esc(ouq) + '"');
            }
        }
        var filter = parts.join(" && ");
        var total = $app.countRecords("domainUsers", filter);
        // Empty + unfiltered means the cache was never synced -> fall back below.
        if (total === 0 && !filter && offset === 0) throw new Error("cache empty");
        var cached = $app.findRecordsByFilter("domainUsers", filter, "+primaryEmail", limit, offset);
        if (cached) {
            var users = [];
            for (var i = 0; i < (cached ? cached.length : 0); i++) {
                var r = cached[i];
                users.push({
                    id: r.get("googleId") || r.id,
                    email: r.get("primaryEmail"),
                    name: r.get("name") || r.get("primaryEmail"),
                    firstName: r.get("firstName") || "",
                    lastName: r.get("lastName") || "",
                    title: r.get("title") || "",
                    department: r.get("department") || "",
                    company: r.get("company") || "",
                    phone: r.get("phone") || "",
                    isAdmin: r.get("isAdmin") || false,
                    suspended: false,
                    orgUnitPath: r.get("orgUnitPath") || "/",
                    isMailboxSetup: true,
                    photoUrl: r.get("photoUrl") || null
                });
            }
            e.json(200, { ok: true, users: users, total: total, limit: limit, offset: offset, nextPageToken: null, fromCache: true });
            return;
        }
    } catch (_) { /* fall through to Directory API */ }

    // Fallback: Directory API
    var ue = e.request.url.query().get("userEmail");
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var ae = t.get("adminEmail") || "";
    var mr = parseInt(e.request.url.query().get("maxResults") || "200");
    var pt = e.request.url.query().get("pageToken") || "";
    var url = "https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=" + mr + "&orderBy=email&projection=full";
    if (pt) url += "&pageToken=" + encodeURIComponent(pt);
    if (q) url += "&query=" + encodeURIComponent(q);
    try {
        var result = h.googleApiCall(sa, ae, ["https://www.googleapis.com/auth/admin.directory.user.readonly"], url);
        var users = (result.users || []).filter(function(u2) { return u2.isMailboxSetup && !u2.suspended; })
            .map(function(u2) { return { id: u2.id, email: u2.primaryEmail, name: (u2.name && u2.name.fullName) || u2.primaryEmail,
                firstName: (u2.name && u2.name.givenName) || "", lastName: (u2.name && u2.name.familyName) || "",
                title: (u2.organizations && u2.organizations[0] && u2.organizations[0].title) || "",
                department: (u2.organizations && u2.organizations[0] && u2.organizations[0].department) || "",
                company: (u2.organizations && u2.organizations[0] && u2.organizations[0].name) || "",
                phone: (u2.phones && u2.phones[0] && u2.phones[0].value) || "",
                isAdmin: u2.isAdmin || false, suspended: u2.suspended || false,
                orgUnitPath: u2.orgUnitPath || "/", isMailboxSetup: true, photoUrl: u2.thumbnailPhotoUrl || null }; });
        e.json(200, { ok: true, users: users, nextPageToken: result.nextPageToken || null });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Sync domain users from Directory API into local PocketBase cache
routerAdd("POST", "/gws/sync-users", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var ae = t.get("adminEmail") || "";
    var dom = t.get("domain") || "";
    try {
        var coll = $app.findCollectionByNameOrId("domainUsers");
    } catch (_) {
        // Auto-create collection if it doesn't exist
        try {
            coll = new Collection({
                name: "domainUsers",
                type: "base",
                fields: [
                    { name: "primaryEmail", type: "text", required: true, unique: true },
                    { name: "googleId", type: "text" },
                    { name: "name", type: "text" },
                    { name: "firstName", type: "text" },
                    { name: "lastName", type: "text" },
                    { name: "title", type: "text" },
                    { name: "department", type: "text" },
                    { name: "company", type: "text" },
                    { name: "phone", type: "text" },
                    { name: "orgUnitPath", type: "text" },
                    { name: "isAdmin", type: "bool" },
                    { name: "photoUrl", type: "text" },
                    { name: "lastSynced", type: "text" }
                ]
            });
            $app.save(coll);
            coll = $app.findCollectionByNameOrId("domainUsers");
        } catch (ce) {
            e.json(500, { error: "collection_create_failed", message: ce.message }); return;
        }
    }
    var total = 0, pageToken = "";
    do {
        var url = "https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=500&orderBy=email&projection=full";
        if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
        var result = h.googleApiCall(sa, ae, ["https://www.googleapis.com/auth/admin.directory.user.readonly"], url);
        console.log("sync-users API result:", JSON.stringify({ usersCount: (result.users || []).length, nextPageToken: result.nextPageToken || null }));
        var gUsers = (result.users || []).filter(function(u2) { return u2.isMailboxSetup && !u2.suspended; });
        console.log("sync-users after filter:", gUsers.length, "first user:", gUsers[0] ? JSON.stringify({ email: gUsers[0].primaryEmail, isMailboxSetup: gUsers[0].isMailboxSetup, suspended: gUsers[0].suspended }) : "none");
        for (var i = 0; i < gUsers.length; i++) {
            var gu = gUsers[i];
            try {
                var existing = $app.findRecordsByFilter("domainUsers", 'primaryEmail="' + gu.primaryEmail.replace(/"/g, '\\"') + '"', "", 1, 0);
                var rec;
                if (existing && existing.length > 0) {
                    rec = existing[0];
                } else {
                    rec = new Record(coll);
                    rec.set("primaryEmail", gu.primaryEmail);
                }
                rec.set("googleId", gu.id);
                rec.set("name", (gu.name && gu.name.fullName) || gu.primaryEmail);
                rec.set("firstName", (gu.name && gu.name.givenName) || "");
                rec.set("lastName", (gu.name && gu.name.familyName) || "");
                rec.set("title", (gu.organizations && gu.organizations[0] && gu.organizations[0].title) || "");
                rec.set("department", (gu.organizations && gu.organizations[0] && gu.organizations[0].department) || "");
                rec.set("company", (gu.organizations && gu.organizations[0] && gu.organizations[0].name) || "");
                rec.set("phone", (gu.phones && gu.phones[0] && gu.phones[0].value) || "");
                rec.set("orgUnitPath", gu.orgUnitPath || "/");
                rec.set("isAdmin", gu.isAdmin || false);
                rec.set("photoUrl", gu.thumbnailPhotoUrl || "");
                rec.set("lastSynced", new Date().toISOString());
                $app.save(rec);
                total++;
            } catch (saveErr) { console.error("sync-users save failed for", gu.primaryEmail, saveErr.message); }
        }
        pageToken = result.nextPageToken || "";
    } while (pageToken);
    h.auditLog(u.id, "users.sync", u.email || u.id, { total: total, domain: dom });
    e.json(200, { ok: true, action: "synced", total: total });
});

// Delegation: list
routerAdd("GET", "/gws/delegation", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var ue = e.request.url.query().get("userEmail");
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    try {
        var r = h.googleApiCall(sa, ue, ["https://www.googleapis.com/auth/gmail.settings.basic", "https://www.googleapis.com/auth/gmail.settings.sharing"],
            "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(ue) + "/settings/delegates");
        e.json(200, { ok: true, delegates: r.delegates || [] });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Delegation: add/remove
routerAdd("POST", "/gws/delegation", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var ue = b.userEmail, act = b.action, de = b.delegateEmail;
    if (!ue || !act) { e.json(400, { error: "userEmail and action required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var sc = ["https://www.googleapis.com/auth/gmail.settings.basic", "https://www.googleapis.com/auth/gmail.settings.sharing"];
    var eu = encodeURIComponent(ue);
    try {
        if (act === "remove") {
            if (!de) { e.json(400, { error: "delegateEmail required" }); return; }
            h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/delegates/" + encodeURIComponent(de), "DELETE");
            h.auditLog(u.id, "delegation.remove", u.email || u.id, { userEmail: ue, delegateEmail: de });
            e.json(200, { ok: true, action: "removed", delegateEmail: de }); return;
        }
        if (!de) { e.json(400, { error: "delegateEmail required" }); return; }
        h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/delegates", "POST", { delegateEmail: de });
        h.auditLog(u.id, "delegation.add", u.email || u.id, { userEmail: ue, delegateEmail: de });
        e.json(200, { ok: true, action: "added", delegateEmail: de });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Forwarding: get
routerAdd("GET", "/gws/forwarding", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var ue = e.request.url.query().get("userEmail");
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var sc = ["https://www.googleapis.com/auth/gmail.settings.basic", "https://www.googleapis.com/auth/gmail.settings.sharing"];
    var eu = encodeURIComponent(ue);
    try {
        var fwd = h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/autoForwarding");
        var adr = h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/forwardingAddresses");
        e.json(200, { ok: true, autoForwarding: fwd, forwardingAddresses: adr.forwardingAddresses || [] });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Forwarding: create/update
routerAdd("POST", "/gws/forwarding", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var ue = b.userEmail, act = b.action;
    if (!ue || !act) { e.json(400, { error: "userEmail and action required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var sc = ["https://www.googleapis.com/auth/gmail.settings.basic", "https://www.googleapis.com/auth/gmail.settings.sharing"];
    var eu = encodeURIComponent(ue);
    try {
        if (act === "createAddress") {
            if (!b.forwardingEmail) { e.json(400, { error: "forwardingEmail required" }); return; }
            var r = h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/forwardingAddresses", "POST", { forwardingEmail: b.forwardingEmail });
            h.auditLog(u.id, "forwarding.createAddress", u.email || u.id, { userEmail: ue, forwardingEmail: b.forwardingEmail });
            e.json(200, { ok: true, forwardingAddress: r }); return;
        }
        if (act === "updateAutoForwarding") {
            var r = h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/autoForwarding", "PUT",
                { enabled: !!b.enabled, emailAddress: b.emailAddress, disposition: b.disposition || "leaveInInbox" });
            h.auditLog(u.id, "forwarding.updateAuto", u.email || u.id, { userEmail: ue, enabled: b.enabled, emailAddress: b.emailAddress });
            e.json(200, { ok: true, autoForwarding: r }); return;
        }
        e.json(400, { error: "unknown action" });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Filters: list
routerAdd("GET", "/gws/filters", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var ue = e.request.url.query().get("userEmail");
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    try {
        var r = h.googleApiCall(sa, ue, ["https://www.googleapis.com/auth/gmail.settings.basic"],
            "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(ue) + "/settings/filters");
        e.json(200, { ok: true, filters: r.filter || [] });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Filters: create/delete
routerAdd("POST", "/gws/filters", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var ue = b.userEmail, act = b.action, crit = b.criteria, fid = b.filterId;
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var sc = ["https://www.googleapis.com/auth/gmail.settings.basic"];
    var eu = encodeURIComponent(ue);
    try {
        if (act === "delete") {
            if (!fid) { e.json(400, { error: "filterId required" }); return; }
            h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/filters/" + encodeURIComponent(fid), "DELETE");
            h.auditLog(u.id, "filter.delete", u.email || u.id, { userEmail: ue, filterId: fid });
            e.json(200, { ok: true, action: "deleted", filterId: fid }); return;
        }
        if (!crit || !act) { e.json(400, { error: "criteria and action required" }); return; }
        var r = h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/filters", "POST", { criteria: crit, action: act });
        h.auditLog(u.id, "filter.create", u.email || u.id, { userEmail: ue, criteria: crit });
        e.json(200, { ok: true, filter: r });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Vacation: get
routerAdd("GET", "/gws/vacation", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var ue = e.request.url.query().get("userEmail");
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    try {
        var r = h.googleApiCall(sa, ue, ["https://www.googleapis.com/auth/gmail.settings.basic"],
            "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(ue) + "/settings/vacation");
        e.json(200, { ok: true, vacation: r });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Vacation: update
routerAdd("POST", "/gws/vacation", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var ue = b.userEmail;
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var sc = ["https://www.googleapis.com/auth/gmail.settings.basic"];
    var eu = encodeURIComponent(ue);
    try {
        var s = { enableAutoReply: !!b.enableAutoReply, responseSubject: b.responseSubject || "", responseBodyHtml: b.responseBodyHtml || "" };
        if (b.startTime) s.startTime = b.startTime;
        if (b.endTime) s.endTime = b.endTime;
        if (typeof b.restrictToContacts === "boolean") s.restrictToContacts = b.restrictToContacts;
        if (typeof b.restrictToDomain === "boolean") s.restrictToDomain = b.restrictToDomain;
        var r = h.googleApiCall(sa, ue, sc, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/vacation", "PUT", s);
        h.auditLog(u.id, "vacation.update", u.email || u.id, { userEmail: ue, enableAutoReply: s.enableAutoReply });
        e.json(200, { ok: true, vacation: r });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Send-As: list
routerAdd("GET", "/gws/send-as", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var ue = e.request.url.query().get("userEmail");
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    try {
        var r = h.googleApiCall(sa, ue, ["https://www.googleapis.com/auth/gmail.settings.basic", "https://www.googleapis.com/auth/gmail.settings.sharing"],
            "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(ue) + "/settings/sendAs");
        e.json(200, { ok: true, sendAs: r.sendAs || [] });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Send-As: add/remove
routerAdd("POST", "/gws/send-as", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var ue = b.userEmail, act = b.action;
    if (!ue || !act) { e.json(400, { error: "userEmail and action required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var ae = t.get("adminEmail") || "";
    var gs = ["https://www.googleapis.com/auth/gmail.settings.basic", "https://www.googleapis.com/auth/gmail.settings.sharing"];
    var eu = encodeURIComponent(ue);
    try {
        if (act === "addAlias") {
            if (!b.aliasEmail) { e.json(400, { error: "aliasEmail required" }); return; }
            try {
                h.googleApiCall(sa, ae, ["https://www.googleapis.com/auth/admin.directory.user"],
                    "https://admin.googleapis.com/admin/directory/v1/users/" + eu + "/aliases", "POST", { alias: b.aliasEmail });
            } catch (aErr) {
                if (!(aErr.message && (aErr.message.indexOf("409") >= 0 || aErr.message.indexOf("already exists") >= 0))) {
                    e.json(400, { error: "alias_insert_failed", message: aErr.message }); return;
                }
            }
            var r = h.googleApiCall(sa, ue, gs, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/sendAs", "POST",
                { sendAsEmail: b.aliasEmail, displayName: b.displayName || "", treatAsAlias: true });
            h.auditLog(u.id, "sendas.addAlias", u.email || u.id, { userEmail: ue, aliasEmail: b.aliasEmail });
            e.json(200, { ok: true, action: "aliasAdded", sendAs: r }); return;
        }
        if (act === "addGroup") {
            if (!b.groupEmail) { e.json(400, { error: "groupEmail required" }); return; }
            try {
                h.googleApiCall(sa, ae, ["https://www.googleapis.com/auth/admin.directory.group.readonly"],
                    "https://admin.googleapis.com/admin/directory/v1/groups/" + encodeURIComponent(b.groupEmail) + "/members/" + eu);
            } catch (_) { e.json(400, { error: "not_group_member", message: ue + " is not a member of " + b.groupEmail }); return; }
            var r = h.googleApiCall(sa, ue, gs, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/sendAs", "POST",
                { sendAsEmail: b.groupEmail, displayName: b.displayName || "", treatAsAlias: true });
            h.auditLog(u.id, "sendas.addGroup", u.email || u.id, { userEmail: ue, groupEmail: b.groupEmail });
            e.json(200, { ok: true, action: "groupAdded", sendAs: r }); return;
        }
        if (act === "remove") {
            if (!b.sendAsEmail) { e.json(400, { error: "sendAsEmail required" }); return; }
            h.googleApiCall(sa, ue, gs, "https://gmail.googleapis.com/gmail/v1/users/" + eu + "/settings/sendAs/" + encodeURIComponent(b.sendAsEmail), "DELETE");
            h.auditLog(u.id, "sendas.remove", u.email || u.id, { userEmail: ue, sendAsEmail: b.sendAsEmail });
            e.json(200, { ok: true, action: "removed", sendAsEmail: b.sendAsEmail }); return;
        }
        e.json(400, { error: "Invalid action" });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Signature: get
routerAdd("GET", "/gws/signature", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var ue = e.request.url.query().get("userEmail");
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var se = e.request.url.query().get("sendAsEmail") || ue;
    try {
        var r = h.googleApiCall(sa, ue, ["https://www.googleapis.com/auth/gmail.settings.basic", "https://www.googleapis.com/auth/gmail.settings.sharing"],
            "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(ue) + "/settings/sendAs/" + encodeURIComponent(se));
        e.json(200, { ok: true, signature: r.signature || "", sendAsEmail: se, displayName: r.displayName || "" });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Signature: update/bulkApply
routerAdd("POST", "/gws/signature", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var act = b.action;
    if (!act) { e.json(400, { error: "action required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var sc = ["https://www.googleapis.com/auth/gmail.settings.basic", "https://www.googleapis.com/auth/gmail.settings.sharing"];
    var ae = t.get("adminEmail") || "";
    try {
        if (act === "update") {
            if (!b.userEmail) { e.json(400, { error: "userEmail required" }); return; }
            var te = b.sendAsEmail || b.userEmail;
            var html = b.signature || "";
            var email = b.userEmail;
            // Prefer userData sent from frontend; fall back to domainUsers cache
            var ud = b.userData || {};
            try {
                if (!ud.name) {
                    var cached = $app.findRecordsByFilter("domainUsers", 'primaryEmail="' + email.replace(/"/g, '\\"') + '"', "", 1, 0);
                    if (cached && cached.length > 0) {
                        var du = cached[0];
                        ud = {
                            name: du.get("name") || email,
                            firstName: du.get("firstName") || "",
                            lastName: du.get("lastName") || "",
                            email: email,
                            title: du.get("title") || "",
                            department: du.get("department") || "",
                            company: du.get("company") || "",
                            phone: du.get("phone") || "",
                            photoUrl: du.get("photoUrl") || ""
                        };
                    }
                }
                html = html.replace(/\{\{name\}\}/g, ud.name || email);
                html = html.replace(/\{\{firstName\}\}/g, ud.firstName || "");
                html = html.replace(/\{\{lastName\}\}/g, ud.lastName || "");
                html = html.replace(/\{\{email\}\}/g, ud.email || email);
                html = html.replace(/\{\{title\}\}/g, ud.title || "");
                html = html.replace(/\{\{department\}\}/g, ud.department || "");
                // Derive company from email domain when cache is empty (sync often wipes it)
                var udcomp = ud.company || "";
                if (!udcomp && email.indexOf("@") > -1) udcomp = email.split("@")[1];
                html = html.replace(/\{\{company\}\}/g, udcomp);
                html = html.replace(/\{\{phone\}\}/g, ud.phone || "");
                html = html.replace(/\{\{photoUrl\}\}/g, ud.photoUrl || "");
            } catch (_) {}
            // Remove empty elements/links left by unresolved placeholders (e.g. empty {{company}})
            html = html.replace(/<a[^>]*>\s*<\/a>/gi, '');
            html = html.replace(/<(?:p|div|span)[^>]*>\s*<\/(?:p|div|span)>/gi, '');
            html = html.replace(/^\s*$/gm, '');
            // Do NOT trust the address the client picked. Gmail answers
            // 400 FAILED_PRECONDITION when you PATCH a sendAs address that is
            // not one of that user's aliases -- which is exactly what happens
            // when the alias list could not be read and the UI fell back to the
            // user's own address. Resolve it server-side and fall back to the
            // client's pick only if the lookup itself fails.
            var token = h.googleAccessToken(sa, b.userEmail, sc);
            var resolved = te;
            try { resolved = h.resolveSendAs(token, b.userEmail); } catch (rErr) {
                if (rErr && rErr.reason === "sendAsUnverified") {
                    e.json(400, { error: "sendAsUnverified", message: rErr.message }); return;
                }
            }
            h.googleApiRequest(token, "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(b.userEmail) + "/settings/sendAs/" + encodeURIComponent(resolved), "PATCH", { signature: html });
            h.auditLog(u.id, "signature.update", u.email || u.id, { userEmail: b.userEmail, sendAsEmail: resolved, requested: te });
            e.json(200, { ok: true, action: "updated", sendAsEmail: resolved }); return;
        }
        if (act === "bulkApply") {
            if (!b.templateId || !b.userEmails || !Array.isArray(b.userEmails) || b.userEmails.length === 0) {
                e.json(400, { error: "templateId and userEmails[] required" }); return;
            }
            var tmpl;
            try { tmpl = $app.findRecordById("signatureTemplates", b.templateId); } catch (_) { e.json(404, { error: "template_not_found" }); return; }
            // json/editor field -> decode (see asArray/asString in lib/helpers.js)
            var thtml = h.asString(tmpl.get("html"));
            var results = [];
            for (var i = 0; i < b.userEmails.length; i++) {
                var email = b.userEmails[i];
                try {
                    // Read user data from local domainUsers cache (fast, no Directory API call)
                    var cached = $app.findRecordsByFilter("domainUsers", 'primaryEmail="' + email.replace(/"/g, '\\"') + '"', "", 1, 0);
                    var uname = email, ufirst = "", ulast = "", utitle = "", udept = "", ucomp = "", uphone = "", uphoto = "";
                    if (cached && cached.length > 0) {
                        uname = cached[0].get("name") || email;
                        ufirst = cached[0].get("firstName") || "";
                        ulast = cached[0].get("lastName") || "";
                        utitle = cached[0].get("title") || "";
                        udept = cached[0].get("department") || "";
                        ucomp = cached[0].get("company") || "";
                        uphone = cached[0].get("phone") || "";
                        uphoto = cached[0].get("photoUrl") || "";
                    }
                    var html = thtml;
                    html = html.replace(/\{\{name\}\}/g, uname);
                    html = html.replace(/\{\{firstName\}\}/g, ufirst);
                    html = html.replace(/\{\{lastName\}\}/g, ulast);
                    html = html.replace(/\{\{email\}\}/g, email);
                    html = html.replace(/\{\{title\}\}/g, utitle);
                    html = html.replace(/\{\{department\}\}/g, udept);
                    // Derive company from email domain when cache is empty (sync often wipes it)
                    if (!ucomp && email.indexOf("@") > -1) ucomp = email.split("@")[1];
                    html = html.replace(/\{\{company\}\}/g, ucomp);
                    html = html.replace(/\{\{phone\}\}/g, uphone);
                    html = html.replace(/\{\{photoUrl\}\}/g, uphoto);
                    // Remove empty elements/links left by unresolved placeholders (e.g. empty {{company}})
                    html = html.replace(/<a[^>]*>\s*<\/a>/gi, '');
                    html = html.replace(/<(?:p|div|span)[^>]*>\s*<\/(?:p|div|span)>/gi, '');
                    html = html.replace(/^\s*$/gm, '');
                    // resolve the alias rather than assuming the user's own
                    // address is a sendAs address (400 FAILED_PRECONDITION)
                    var ltok = h.googleAccessToken(sa, email, sc);
                    var lsenda = email;
                    try { lsenda = h.resolveSendAs(ltok, email); } catch (_) {}
                    h.googleApiRequest(ltok, "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(email) + "/settings/sendAs/" + encodeURIComponent(lsenda), "PATCH", { signature: html });
                    results.push({ email: email, ok: true });
                } catch (uer) { results.push({ email: email, ok: false, error: uer.message }); }
            }
            h.auditLog(u.id, "signature.bulkApply", u.email || u.id, { templateId: b.templateId, userCount: b.userEmails.length });
            e.json(200, { ok: true, action: "bulkApplied", results: results }); return;
        }
        e.json(400, { error: "Invalid action" });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Signature Templates: CRUD
routerAdd("GET", "/gws/signature-templates", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    try {
        var recs = $app.findRecordsByFilter("signatureTemplates", "", "+name", 100, 0);
        var tmpls = [];
        for (var i = 0; i < (recs ? recs.length : 0); i++) {
            tmpls.push({ id: recs[i].id, name: recs[i].get("name"), html: recs[i].get("html"),
                updatedBy: recs[i].get("updatedBy"), created: recs[i].get("created"), updated: recs[i].get("updated") });
        }
        e.json(200, { ok: true, templates: tmpls });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

routerAdd("POST", "/gws/signature-templates", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var act = b.action;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var coll = $app.findCollectionByNameOrId("signatureTemplates");
    try {
        if (act === "delete") {
            if (!b.templateId) { e.json(400, { error: "templateId required" }); return; }
            var delRec = $app.findRecordById("signatureTemplates", b.templateId); $app.delete(delRec);
            h.auditLog(u.id, "signatureTemplate.delete", u.email || u.id, { templateId: b.templateId });
            e.json(200, { ok: true, action: "deleted", templateId: b.templateId }); return;
        }
        if (!b.name || typeof b.html !== "string") { e.json(400, { error: "name and html required" }); return; }
        // Update existing template — always allowed
        if (b.templateId) {
            var rec = $app.findRecordById("signatureTemplates", b.templateId);
            rec.set("name", b.name); rec.set("html", b.html); rec.set("updatedBy", u.email || u.id);
            $app.save(rec);
            h.auditLog(u.id, "signatureTemplate.update", u.email || u.id, { templateId: b.templateId, name: b.name });
            e.json(200, { ok: true, action: "updated", templateId: b.templateId }); return;
        }
        // Create new template
        var nr = new Record(coll);
        nr.set("name", b.name); nr.set("html", b.html); nr.set("updatedBy", u.email || u.id);
        $app.save(nr);
        h.auditLog(u.id, "signatureTemplate.create", u.email || u.id, { templateId: nr.id, name: b.name });
        e.json(200, { ok: true, action: "created", templateId: nr.id });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Calendar ACL
routerAdd("GET", "/gws/calendar-acl", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var ue = e.request.url.query().get("userEmail");
    if (!ue) { e.json(400, { error: "userEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    try {
        var r = h.googleApiCall(sa, ue, ["https://www.googleapis.com/auth/calendar"], "https://www.googleapis.com/calendar/v3/calendars/primary/acl");
        e.json(200, { ok: true, items: r.items || [] });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

routerAdd("POST", "/gws/calendar-acl", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var ue = b.userEmail, act = b.action;
    if (!ue || !act) { e.json(400, { error: "userEmail and action required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var sc = ["https://www.googleapis.com/auth/calendar"];
    var base = "https://www.googleapis.com/calendar/v3/calendars/primary/acl";
    try {
        if (act === "add") {
            if (!b.role) { e.json(400, { error: "role required" }); return; }
            var scope = { type: b.scopeType || "user" }; if (b.scopeValue) scope.value = b.scopeValue;
            var r = h.googleApiCall(sa, ue, sc, base, "POST", { role: b.role, scope: scope });
            h.auditLog(u.id, "calendar.acl.add", u.email || u.id, { userEmail: ue, role: b.role, scopeType: b.scopeType, scopeValue: b.scopeValue });
            e.json(200, { ok: true, action: "added", rule: r }); return;
        }
        if (act === "update") {
            if (!b.ruleId || !b.role) { e.json(400, { error: "ruleId and role required" }); return; }
            var r = h.googleApiCall(sa, ue, sc, base + "/" + b.ruleId, "PATCH", { role: b.role });
            h.auditLog(u.id, "calendar.acl.update", u.email || u.id, { userEmail: ue, ruleId: b.ruleId, role: b.role });
            e.json(200, { ok: true, action: "updated", rule: r }); return;
        }
        if (act === "remove") {
            if (!b.ruleId) { e.json(400, { error: "ruleId required" }); return; }
            h.googleApiCall(sa, ue, sc, base + "/" + b.ruleId, "DELETE");
            h.auditLog(u.id, "calendar.acl.remove", u.email || u.id, { userEmail: ue, ruleId: b.ruleId });
            e.json(200, { ok: true, action: "removed", ruleId: b.ruleId }); return;
        }
        e.json(400, { error: "action must be add, update, or remove" });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Groups
routerAdd("GET", "/gws/groups", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var ae = t.get("adminEmail") || "";
    var mr = parseInt(e.request.url.query().get("maxResults") || "200");
    var pt = e.request.url.query().get("pageToken") || "";
    var url = "https://admin.googleapis.com/admin/directory/v1/groups?customer=my_customer&maxResults=" + mr + "&orderBy=email";
    if (pt) url += "&pageToken=" + encodeURIComponent(pt);
    try {
        var r = h.googleApiCall(sa, ae, ["https://www.googleapis.com/auth/admin.directory.group.readonly"], url);
        var gs = (r.groups || []).map(function(g) { return { id: g.id, email: g.email, name: g.name || g.email, description: g.description || "", memberCount: g.directMembersCount || 0 }; });
        e.json(200, { ok: true, groups: gs, nextPageToken: r.nextPageToken || null });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

routerAdd("GET", "/gws/group-members", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var ge = e.request.url.query().get("groupEmail");
    if (!ge) { e.json(400, { error: "groupEmail required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var sa = h.decryptSAKey(t); if (!sa) { e.json(400, { error: "no_service_account" }); return; }
    var ae = t.get("adminEmail") || "";
    try {
        // Page through all members. A page caps at 200 and returns nextPageToken;
        // ignoring it silently truncates large groups.
        var ms = [], pt = "", pages = 0;
        do {
            var gurl = "https://admin.googleapis.com/admin/directory/v1/groups/" + encodeURIComponent(ge) + "/members?maxResults=200";
            if (pt) gurl += "&pageToken=" + encodeURIComponent(pt);
            var r = h.googleApiCall(sa, ae, ["https://www.googleapis.com/auth/admin.directory.group.readonly"], gurl);
            var batch = (r.members || []).filter(function(m) { return m.type === "USER" && m.email; });
            for (var bi = 0; bi < batch.length; bi++) ms.push({ email: batch[bi].email, role: batch[bi].role || "MEMBER" });
            pt = r.nextPageToken || "";
            pages++;
        } while (pt && pages < 100);
        e.json(200, { ok: true, members: ms, count: ms.length, truncated: !!pt, nestedMembersExpanded: false });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// GCP Setup (OAuth-based)
routerAdd("POST", "/gws/setup-gcp-project", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var dom = b.domain, ae = b.adminEmail, tok = b.gcpAccessToken, pid = b.projectId;
    if (!dom || !ae || !tok || !pid) { e.json(400, { error: "All fields required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    pid = String(pid).trim();
    var gh = { "Authorization": "Bearer " + tok, "Content-Type": "application/json" };
    try {
        try { $http.send({ url: "https://serviceusage.googleapis.com/v1/projects/" + encodeURIComponent(pid) + "/services:batchEnable", method: "POST", body: JSON.stringify({ serviceIds: ["admin.googleapis.com", "gmail.googleapis.com"] }), headers: gh, timeout: 30 }); } catch (_) {}
        var saId = "gws-admin-sa", saEmail = saId + "@" + pid + ".iam.gserviceaccount.com";
        try {
            var sr = $http.send({ url: "https://iam.googleapis.com/v1/projects/" + encodeURIComponent(pid) + "/serviceAccounts", method: "POST",
                body: JSON.stringify({ accountId: saId, serviceAccount: { displayName: "GWS Admin Service Account", description: "GWS Admin domain-wide delegation" } }), headers: gh, timeout: 15 });
            saEmail = sr.json.email;
        } catch (se) { if (!(se.message && se.message.indexOf("409") >= 0)) { e.json(400, { error: "sa_create_failed", message: se.message }); return; } }
        var kj;
        try {
            var kr = $http.send({ url: "https://iam.googleapis.com/v1/projects/" + encodeURIComponent(pid) + "/serviceAccounts/" + encodeURIComponent(saEmail) + "/keys", method: "POST", body: "{}", headers: gh, timeout: 15 });
            kj = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(kr.json.privateKeyData)));
        } catch (ke) { e.json(400, { error: "key_create_failed", message: ke.message }); return; }
        var coll = $app.findCollectionByNameOrId("users"); var rec = $app.findRecordById(coll, u.id);
        rec.set("domain", dom); rec.set("adminEmail", ae); rec.set("serviceAccountKey", h.encryptSAKey(kj)); rec.set("gcpProjectId", pid); $app.save(rec);
        h.auditLog(u.id, "domain.connect", u.email || u.id, { domain: dom, adminEmail: ae, method: "oauth-setup", projectId: pid });
        e.json(200, { ok: true, clientId: kj.client_id, serviceAccountEmail: saEmail, projectId: pid });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Webhook config
routerAdd("POST", "/gws/webhook-config", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    var act = b.action;
    if (!act) { e.json(400, { error: "action required" }); return; }
    var t = h.getUserConfig(e, u.id); if (!t) return;
    try {
        var coll = $app.findCollectionByNameOrId("users"); var rec = $app.findRecordById(coll, u.id);
        if (act === "save") {
            var wu = b.webhookUrl || "";
            if (wu) { try { new URL(wu); } catch (_) { e.json(400, { error: "Invalid URL" }); return; } }
            rec.set("webhookUrl", wu); $app.save(rec);
            e.json(200, { ok: true, action: wu ? "saved" : "cleared" }); return;
        }
        if (act === "test") {
            var url = t.get("webhookUrl");
            if (!url) { e.json(400, { error: "No webhook URL configured." }); return; }
            var r = $http.send({ url: url, method: "POST", body: JSON.stringify({ text: "\u2705 *GWS Admin* \u2014 Webhook test successful!" }), headers: { "Content-Type": "application/json" }, timeout: 5 });
            e.json(200, { ok: true, status: r.statusCode }); return;
        }
        e.json(400, { error: "action must be save or test" });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

console.log("\u2705 GWS-Admin PocketBase hooks loaded");

// Shout at boot if the encryption key is missing. Without it the app starts and
// looks perfectly healthy, but encryptSAKey falls back to storing the Google
// service-account key in PLAINTEXT -- a failure that is invisible until it
// matters. Deliberately a warning, not a hard exit: an install that is already
// running without a key must not be broken by an upgrade. Docker installs are
// protected properly, by a required variable in docker-compose.yml.
try {
    if (!$os.getenv("ENCRYPTION_KEY")) {
        console.error("**********************************************************************");
        console.error("* ENCRYPTION_KEY IS NOT SET");
        console.error("* The Google service-account key will be stored in PLAINTEXT.");
        console.error("* Set ENCRYPTION_KEY before storing a key. See the README.");
        console.error("**********************************************************************");
    }
} catch (_) {}

// Disable browser caching for all static files served by PocketBase
routerUse((e) => {
    try {
        var path = e.request.url.path;
        if (path.startsWith("/js/") || path.startsWith("/styles/") || path.startsWith("/components/") || path === "/" || path === "/index.html") {
            e.response.header().set("Cache-Control", "no-cache, no-store, must-revalidate");
            e.response.header().set("Pragma", "no-cache");
            e.response.header().set("Expires", "0");
        }
    } catch(_) {}
    return e.next();
});

// Serve static frontend files including components

// ─────────────────────────────────────────────────────────────────────────────
// Bulk operations: audience targeting + chunked apply
// ─────────────────────────────────────────────────────────────────────────────

// Distinct org units derived from the local domainUsers cache (no Directory call).
routerAdd("GET", "/gws/org-units", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    try {
        var all = $app.findRecordsByFilter("domainUsers", "", "+orgUnitPath", 0, 0);
        var counts = {};
        for (var i = 0; i < all.length; i++) {
            var path = all[i].get("orgUnitPath") || "/";
            counts[path] = (counts[path] || 0) + 1;
        }
        // Build a tree. "/" is the root; "/A/B" nests under "/A".
        var nodes = {};
        var paths = Object.keys(counts);
        for (var pi = 0; pi < paths.length; pi++) {
            var pth = paths[pi];
            nodes[pth] = { path: pth, name: (pth === "/" ? "Top level" : pth.substring(pth.lastIndexOf("/") + 1)), directCount: counts[pth], totalCount: 0, children: [] };
        }
        // Roll child counts into ancestors so "include sub-OUs" can show a total.
        var sorted = paths.slice().sort(function(a, b) { return a.length - b.length; });
        for (var si = sorted.length - 1; si >= 0; si--) {
            var cur = sorted[si];
            var node = nodes[cur];
            var parts = (cur === "/") ? [] : cur.split("/").filter(function(x) { return x !== ""; });
            var parentPath = "/";
            if (parts.length > 1) parentPath = "/" + parts.slice(0, parts.length - 1).join("/");
            if (nodes[parentPath] && parentPath !== cur) {
                node.parent = parentPath;
                nodes[parentPath].children.push(node);
            }
            node.totalCount += node.directCount;
            if (node.parent && nodes[node.parent]) nodes[node.parent].totalCount += node.totalCount;
        }
        var roots = [];
        for (var k in nodes) { if (!nodes[k].parent) roots.push(nodes[k]); }
        roots.sort(function(a, b) { return a.path < b.path ? -1 : 1; });
        e.json(200, { ok: true, units: roots, flatCount: paths.length });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Resolve an audience selector to a concrete list of addresses.
// NOTE: nested/derived group membership is NOT expanded — direct members only.
routerAdd("POST", "/gws/audience/resolve", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var b = JSON.parse(toString(e.request.body));
    try {
        // One implementation, shared with the scheduler. This route used to hold
        // its own copy, which is how the same logic ends up fixed in one place.
        var emails = h.resolveAudience(b, t);
        e.json(200, { ok: true, emails: emails, count: emails.length, nestedMembersExpanded: false });
    } catch (err) {
        if (err && err.message === "NO_SERVICE_ACCOUNT") { e.json(400, { error: "no_service_account" }); return; }
        e.json(500, { error: "internal_error", message: err.message });
    }
});

// Create a bulk job. Returns immediately; the cron worker does the work.
routerAdd("POST", "/gws/bulk/start", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var b = JSON.parse(toString(e.request.body));
    // Either an inline signature (usual: from the editor) or a saved template.
    var htmlInline = (typeof b.html === "string") ? b.html : "";
    if (!htmlInline.trim() && !b.templateId) {
        e.json(400, { error: "html or templateId required" }); return;
    }
    var list = b.emails || [];
    if (!list.length) { e.json(400, { error: "no recipients — resolve an audience first" }); return; }
    try {
        if (b.templateId) {
            // confirm it exists (ownerId scoping is not used in the single-tenant build)
            try { $app.findRecordById("signatureTemplates", b.templateId); }
            catch (_) { e.json(404, { error: "template_not_found" }); return; }
        }
        var coll = $app.findCollectionByNameOrId("bulkJobs");
        var rec = new Record(coll);
        rec.set("status", "running");
        rec.set("selector", b.selector || {});
        rec.set("emails", list);
        rec.set("templateId", b.templateId || "");
        // the html travels with the job, so no throwaway template row is needed
        if (htmlInline.trim()) rec.set("htmlOverride", htmlInline);
        rec.set("total", list.length);
        rec.set("done", 0);
        rec.set("failed", []);
        rec.set("chunkSize", b.chunkSize || 25);
        // A dry run resolves the audience and renders every signature, but does
        // not call Gmail. This is the only way to see what a run WOULD do before
        // letting it touch a production domain.
        rec.set("dryRun", !!b.dryRun);
        rec.set("createdBy", u.id);
        rec.set("startedAt", new Date());
        $app.save(rec);
        h.auditLog(u.id, "signature.bulkStart", u.email || u.id, { jobId: rec.id, total: list.length, dryRun: !!b.dryRun });
        e.json(200, { ok: true, jobId: rec.id, total: list.length,
            chunkSize: rec.get("chunkSize"), dryRun: !!b.dryRun });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Poll progress.
routerAdd("GET", "/gws/bulk/status", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var id = e.request.url.query().get("id");
    if (!id) { e.json(400, { error: "id required" }); return; }
    try {
        var rec = $app.findRecordById("bulkJobs", id);
        var failed = h.asArray(rec.get("failed"));
        e.json(200, { ok: true, jobId: rec.id, status: rec.get("status"),
            total: rec.get("total") || 0, done: rec.get("done") || 0,
            // `failed` is capped for the progress view; failedCount is the true
            // total so the UI can tell there is more to fetch from
            // /gws/bulk/failures instead of silently showing only the first 100.
            failedCount: failed.length, failedTotal: failed.length,
            failed: failed.slice(0, 100),
            startedAt: rec.get("startedAt"), finishedAt: rec.get("finishedAt"),
            dryRun: !!rec.get("dryRun"),
            lockedAt: rec.get("lockedAt") || null,
            retries: rec.get("retries") || 0,
            rateLimited: rec.get("rateLimited") || 0,
            throttledMs: rec.get("throttledMs") || 0,
            avgMsPerUser: rec.get("avgMsPerUser") || 0,
            stallCount: rec.get("stallCount") || 0,
            // rough estimate of remaining wall-clock time, for the UI
            etaMs: (rec.get("avgMsPerUser") || 0) *
                   Math.max(0, (rec.get("total") || 0) - (rec.get("done") || 0)),
            lastError: rec.get("lastError") || "" });
    } catch (err) { e.json(404, { error: "job_not_found" }); }
});

// Re-queue only the failed addresses of a finished job.
routerAdd("POST", "/gws/bulk/retry", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var b = JSON.parse(toString(e.request.body));
    if (!b.jobId) { e.json(400, { error: "jobId required" }); return; }
    try {
        var old = $app.findRecordById("bulkJobs", b.jobId);
        var failed = h.asArray(old.get("failed"));
        if (!failed.length) { e.json(400, { error: "nothing to retry" }); return; }
        var emails = failed.map(function(f) { return f.email; });
        var coll = $app.findCollectionByNameOrId("bulkJobs");
        var rec = new Record(coll);
        rec.set("status", "running");
        rec.set("selector", old.get("selector") || {});
        rec.set("emails", emails);
        rec.set("templateId", old.get("templateId") || "");
        var oldHtml = h.asString(old.get("htmlOverride"));
        if (oldHtml) rec.set("htmlOverride", oldHtml);
        rec.set("total", emails.length);
        rec.set("done", 0);
        rec.set("failed", []);
        rec.set("chunkSize", old.get("chunkSize") || 25);
        rec.set("dryRun", false);   // a retry always really applies
        rec.set("createdBy", u.id);
        rec.set("startedAt", new Date());
        $app.save(rec);
        e.json(200, { ok: true, jobId: rec.id, total: emails.length });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});


//
// Once a minute: turn any DUE schedule into a bulkJob. The existing worker then
// drains it, so batching, per-user progress, retry/backoff, resume-after-restart
// and the jobs view are all reused rather than reimplemented.
//
// Two behaviours worth knowing:
//   * A schedule will NOT queue a new job while its previous job is still
//     running. Otherwise a long run on a one-minute cadence would pile up
//     hundreds of jobs behind it.
//   * If several schedules fall due in the same minute they queue together, but
//     the worker processes ONE job per tick -- so they apply one after another,
//     roughly a minute apart, not simultaneously. That is deliberate: concurrent
//     runs would double the load on the same Google quota.
cronAdd("gws-scheduler", "* * * * *", () => {
    var h = require(__hooks + "/../lib/helpers.js");
    var now = Date.now();
    try {
        var due = $app.findRecordsByFilter("bulkSchedules",
            'enabled = true && nextRunAt != null && nextRunAt <= {:now}',
            "+nextRunAt", 5, 0, { now: new Date(now) });

        for (var i = 0; i < due.length; i++) {
            var s = due[i];
            var srec = { freq: s.get("freq"), time: s.get("time"),
                weekdays: h.asArray(s.get("weekdays")), dayOfMonth: s.get("dayOfMonth"),
                intervalMinutes: s.get("intervalMinutes"), startsAt: s.get("startsAt"),
                lastRunAt: s.get("lastRunAt"), tzOffsetMinutes: s.get("tzOffsetMinutes") };

            // advance the clock FIRST, so a failure below cannot leave a schedule
            // stuck in the past firing on every single tick
            var nxt = h.nextRunAfter(srec, now);
            s.set("nextRunAt", nxt ? new Date(nxt) : null);
            s.set("lastRunAt", new Date(now));
            s.set("runCount", (s.get("runCount") || 0) + 1);

            try {
                // skip if this schedule's previous job is still going
                var stillRunning = $app.findRecordsByFilter("bulkJobs",
                    'scheduleId = {:sid} && (status = "running" || status = "queued")',
                    "", 1, 0, { sid: s.id });
                if (stillRunning && stillRunning.length) {
                    s.set("lastStatus", "skipped");
                    s.set("lastError", "previous run is still in progress");
                    $app.save(s);
                    continue;
                }

                var owner = null;
                try { owner = $app.findRecordById("users", s.get("createdBy")); } catch (_) {}
                if (!owner) {
                    s.set("lastStatus", "error");
                    s.set("lastError", "owner user no longer exists");
                    s.set("enabled", false);
                    $app.save(s);
                    continue;
                }

                var emails = h.resolveAudience(h.asObject(s.get("selector")), owner);
                if (!emails.length) {
                    s.set("lastStatus", "skipped");
                    s.set("lastError", "audience resolved to 0 recipients");
                    s.set("lastRecipients", 0);
                    $app.save(s);
                    continue;
                }

                var jobColl = $app.findCollectionByNameOrId("bulkJobs");
                var job = new Record(jobColl);
                job.set("status", "running");
                job.set("selector", h.asObject(s.get("selector")));
                job.set("emails", emails);
                job.set("total", emails.length);
                job.set("done", 0);
                job.set("failed", []);
                job.set("chunkSize", 25);
                job.set("dryRun", false);
                job.set("scheduleId", s.id);
                job.set("createdBy", s.get("createdBy"));
                job.set("startedAt", new Date());
                var jh = h.asString(s.get("htmlOverride"));
                if (jh.trim()) job.set("htmlOverride", jh);
                if (s.get("templateId")) job.set("templateId", s.get("templateId"));
                $app.save(job);

                s.set("lastJobId", job.id);
                s.set("lastStatus", "queued");
                s.set("lastError", "");
                s.set("lastRecipients", emails.length);
                $app.save(s);
                h.auditLog(s.get("createdBy"), "schedule.fire", s.get("title") || s.id,
                    { scheduleId: s.id, jobId: job.id, recipients: emails.length });
            } catch (perr) {
                s.set("lastStatus", "error");
                s.set("lastError", String((perr && perr.message) || perr));
                $app.save(s);
            }
        }
    } catch (err) {
        console.log("gws-scheduler error: " + ((err && err.message) || err));
    }
});

// Bulk worker.
//
// Design notes, all of which exist because of large domains:
//
//  * TIME BUDGET, not a fixed chunk. The old version did exactly `chunkSize`
//    users per minute, so throughput was capped at 25/min (= 33 hours for a
//    50k-user domain) no matter how fast Google answered. This version keeps
//    working until it has used its budget, so a fast domain finishes far
//    sooner and a slow one simply does less per tick.
//  * PROGRESS SAVED PER USER. A restart resumes on the exact user it stopped
//    on, not at the start of the chunk.
//  * OVERLAP LOCK. A tick that overruns its 60s slot used to be re-entered by
//    the next tick, which would read a stale `done` and re-apply the same
//    users. The job is now held for the duration of a tick.
//  * RETRY WITH BACKOFF. 429/5xx are retried with exponential backoff + jitter
//    (see lib/helpers.js). Previously any 429 was recorded as a permanent
//    failure and never retried.
//  * TOKEN REUSED ACROSS RETRIES. The OAuth token is fetched once per user, so
//    retrying does not hammer the token endpoint, which is rate limited too.
cronAdd("gws-bulk-worker", "* * * * *", () => {
    var BUDGET_MS = 50000;    // stay well inside the 60s tick
    var LOCK_MS = 240000;     // a crashed tick frees the job after 4 minutes
    var STALL_LIMIT = 3;      // consecutive no-progress ticks before failing
    var h = require(__hooks + "/../lib/helpers.js");
    var job = null;
    try {
        // Pick the oldest RUNNABLE job, not simply the oldest job.
        //
        // Previously this asked for limit 1 and returned early if that one job
        // happened to be locked, which meant a single locked or stalled job
        // blocked every other job in the queue indefinitely (verified: a job
        // whose owner user was deleted held the queue for 5 ticks and stopped
        // an unrelated job behind it from ever running).
        //
        // Jobs are still processed one at a time on purpose: each user costs
        // several HTTP calls, and two concurrent runs would double the pressure
        // on the same per-project Google quota and cause more throttling for
        // both. The fix is fairness, not concurrency.
        var running = $app.findRecordsByFilter("bulkJobs", 'status = "running"', "+startedAt", 50, 0);
        if (!running || !running.length) return;

        // dateMs() returns 0 for an unset date field -- an unset date is a truthy
        // Go zero-time object, so `if (!held)` would NOT catch it. See dateMs().
        var isFree = function (cand) {
            var held = h.dateMs(cand.get("lockedAt"));
            if (!held) return true;
            var ageMs = Date.now() - held;
            return ageMs < 0 || ageMs >= LOCK_MS;
        };

        // Pass 1: oldest job that is free AND was productive last time.
        // Pass 2: oldest free job, even if it stalled last time.
        //
        // Without pass 2's ordering, a job that can never make progress would be
        // picked on every single tick purely because it is the oldest, and every
        // job queued behind it would starve forever.
        for (var pass = 0; pass < 2 && !job; pass++) {
            for (var ri = 0; ri < running.length; ri++) {
                var cand = running[ri];
                if (!isFree(cand)) continue;
                if (pass === 0 && (cand.get("stallCount") || 0) > 0) continue;
                job = cand;
                break;
            }
        }
        if (!job) return;   // every running job is currently locked
        job.set("lockedAt", new Date());
        $app.save(job);

        // MUST normalise: a json field can arrive as a JSON string, whose
        // .length is the character count. See asArray() in lib/helpers.js.
        var emails = h.asArray(job.get("emails"));
        var done = job.get("done") || 0;
        var failed = h.asArray(job.get("failed"));
        var dryRun = !!job.get("dryRun");
        var budget = job.get("maxPerTick") || 100000;   // hard safety cap
        var retryOn5xx = !dryRun;                       // PATCH is idempotent

        if (done >= emails.length) {
            job.set("status", failed.length ? "failed" : "done");
            job.set("finishedAt", new Date());
            job.set("lockedAt", null);
            $app.save(job);
            return;
        }

        // resolve config + template once per tick
        var ucfg = null;
        try { ucfg = $app.findRecordById("users", job.get("createdBy")); } catch (_) {}
        if (!ucfg && !dryRun) {
            // The owner was deleted. Previously this threw on every tick and the
            // job stayed "running" forever, blocking the queue. Fail it instead.
            job.set("status", "failed");
            job.set("lastError", "owner user no longer exists");
            job.set("finishedAt", new Date());
            job.set("lockedAt", null);
            $app.save(job);
            return;
        }
        var sa = null;
        if (!dryRun) {
            // A dry run calls nothing, so it must not demand a service account —
            // you should be able to preview an audience before wiring Google up.
            try { sa = h.decryptSAKey(ucfg); } catch (_) {}
            if (!sa) {
                job.set("status", "failed");
                job.set("lastError", "service account unavailable");
                job.set("lockedAt", null);
                $app.save(job);
                return;
            }
        }
        // The html usually travels on the job (editor content). Fall back to a
        // saved template when one was named instead.
        // `html`/`htmlOverride` are editor fields: PocketBase hands them back as a
        // byte slice, so decode before testing. An effectively-empty signature
        // would set an EMPTY signature on every recipient, i.e. wipe theirs.
        var thtml = h.asString(job.get("htmlOverride"));
        if (!thtml.trim() && job.get("templateId")) {
            var tmpl = $app.findRecordById("signatureTemplates", job.get("templateId"));
            thtml = h.asString(tmpl.get("html"));
        }
        var visible = String(thtml)
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/gi, " ")
            .trim();
        var hasMedia = /<(img|hr|table|tbody|tr|td)\b/i.test(thtml);
        if (!visible && !hasMedia) {
            job.set("status", "failed");
            job.set("lastError", "signature is empty - refusing to apply it (it would clear every signature)");
            job.set("finishedAt", new Date());
            job.set("lockedAt", null);
            $app.save(job);
            if (job.get("scheduleId")) {
                try {
                    var se = $app.findRecordById("bulkSchedules", job.get("scheduleId"));
                    se.set("lastStatus", "error");
                    se.set("lastError", "signature is empty");
                    se.set("failedRuns", (se.get("failedRuns") || 0) + 1);
                    $app.save(se);
                } catch (_) {}
            }
            return;
        }
        var sc = ["https://www.googleapis.com/auth/gmail.settings.basic",
                  "https://www.googleapis.com/auth/gmail.settings.sharing"];

        var stats = {
            retries: job.get("retries") || 0,
            rateLimited: job.get("rateLimited") || 0,
            throttledMs: job.get("throttledMs") || 0
        };

        var t0 = Date.now();
        var processedThisTick = 0;
        var doneAtStart = done;
        var i = done;

        while (i < emails.length && processedThisTick < budget) {
            if (Date.now() - t0 > BUDGET_MS) break;

            var email = emails[i];
            var userStart = Date.now();
            try {
                var cached = $app.findRecordsByFilter("domainUsers",
                    'primaryEmail="' + String(email).replace(/"/g, '\\"') + '"', "", 1, 0);
                var uname = email, ufirst = "", ulast = "", utitle = "", udept = "",
                    ucomp = "", uphone = "", uphoto = "";
                if (cached && cached.length > 0) {
                    uname = cached[0].get("name") || email;
                    ufirst = cached[0].get("firstName") || "";
                    ulast = cached[0].get("lastName") || "";
                    utitle = cached[0].get("title") || "";
                    udept = cached[0].get("department") || "";
                    ucomp = cached[0].get("company") || "";
                    uphone = cached[0].get("phone") || "";
                    uphoto = cached[0].get("photoUrl") || "";
                }
                var html = thtml;
                html = html.replace(/\{\{name\}\}/g, uname);
                html = html.replace(/\{\{firstName\}\}/g, ufirst);
                html = html.replace(/\{\{lastName\}\}/g, ulast);
                html = html.replace(/\{\{email\}\}/g, email);
                html = html.replace(/\{\{title\}\}/g, utitle);
                html = html.replace(/\{\{department\}\}/g, udept);
                if (!ucomp && String(email).indexOf("@") > -1) ucomp = String(email).split("@")[1];
                html = html.replace(/\{\{company\}\}/g, ucomp);
                html = html.replace(/\{\{phone\}\}/g, uphone);
                html = html.replace(/\{\{photoUrl\}\}/g, uphoto);
                html = html.replace(/<a[^>]*>\s*<\/a>/gi, '');
                html = html.replace(/<(?:p|div|span)[^>]*>\s*<\/(?:p|div|span)>/gi, '');
                html = html.replace(/^\s*$/gm, '');

                if (!dryRun) {
                    // token once per user, reused by every retry of this call
                    var token = h.googleAccessToken(sa, email, sc);
                    // Write to the user's DEFAULT send-as alias, not blindly to
                    // their address: patching a sendAs address that is not one
                    // of that user's aliases fails 400 FAILED_PRECONDITION.
                    var sendAsEmail = h.resolveSendAs(token, email);
                    h.googleApiRequest(token,
                        "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(email) +
                        "/settings/sendAs/" + encodeURIComponent(sendAsEmail),
                        "PATCH", { signature: html }, { stats: stats, retryOn5xx: retryOn5xx });
                }
            } catch (uer) {
                var st = h.statusOf(uer);
                failed.push({ email: email, error: String(uer.message || uer),
                    status: st || 0, reason: uer.reason || "",
                    at: new Date().toISOString() });
            }

            i++;
            processedThisTick++;
            // --- save after EVERY user, so a restart resumes precisely here ---
            job.set("done", i);
            job.set("failed", failed);
            job.set("retries", stats.retries);
            job.set("rateLimited", stats.rateLimited);
            job.set("throttledMs", stats.throttledMs);
            var elapsed = Date.now() - userStart;
            var prevAvg = job.get("avgMsPerUser") || 0;
            var prevN = (i - done - 1);
            job.set("avgMsPerUser", Math.round((prevAvg * prevN + elapsed) / Math.max(1, prevN + 1)));
            $app.save(job);
        }

        job.set("done", i);
        job.set("failed", failed);
        if (i >= emails.length) {
            job.set("status", failed.length ? "failed" : "done");
            job.set("finishedAt", new Date());
            // tell the schedule how its run went
            if (job.get("scheduleId")) {
                try {
                    var sched = $app.findRecordById("bulkSchedules", job.get("scheduleId"));
                    var applied = i - failed.length;
                    sched.set("appliedUsers", (sched.get("appliedUsers") || 0) + applied);
                    sched.set("failedUsers", (sched.get("failedUsers") || 0) + failed.length);
                    if (failed.length) {
                        sched.set("failedRuns", (sched.get("failedRuns") || 0) + 1);
                        sched.set("lastStatus", "failed");
                        sched.set("lastError", failed.length + " of " + i + " failed");
                    } else {
                        sched.set("successRuns", (sched.get("successRuns") || 0) + 1);
                        sched.set("lastStatus", "success");
                        sched.set("lastError", "");
                    }
                    $app.save(sched);
                } catch (_) {}
            }
        } else if (i === doneAtStart) {
            // No progress this tick. A job that can never advance must not hold
            // the queue, so count consecutive stalls and fail it.
            var sc = (job.get("stallCount") || 0) + 1;
            job.set("stallCount", sc);
            if (sc >= STALL_LIMIT) {
                job.set("status", "failed");
                job.set("finishedAt", new Date());
                job.set("lastError", "stalled: no progress in " + sc + " consecutive ticks");
            }
        } else {
            job.set("stallCount", 0);
        }
        job.set("lockedAt", null);
        $app.save(job);
    } catch (err) {
        console.log("gws-bulk-worker error: " + (err && err.message ? err.message : err));
        // never leave the job locked, or it stalls for LOCK_MS
        try {
            if (job) { job.set("lockedAt", null); job.set("lastError", String(err.message || err)); $app.save(job); }
        } catch (_) {}
    }
});

// ── Scheduled applies ────────────────────────────────────────────────────────
//
// A schedule holds what to apply (signature + audience selector) and when
// (recurrence rule). The gws-scheduler cron turns a due schedule into a bulkJob
// and the existing worker drains it, so batching/retry/resume/progress are all
// reused. Recurrence maths lives in lib/helpers.js (nextRunAfter) so the UI and
// the cron cannot disagree about when something is next due.


routerAdd("GET", "/gws/bulk/schedules", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var oneId = e.request.url.query().get("id");
    try {
        if (oneId) {
            // single schedule, WITH its stored html -- the list payload omits it
            // because it can be large.
            var one = $app.findRecordById("bulkSchedules", oneId);
            var payload = h.schedulePayload(one);
            payload.html = h.asString(one.get("htmlOverride"));
            e.json(200, { ok: true, schedule: payload }); return;
        }
        var recs = $app.findRecordsByFilter("bulkSchedules", "", "+title", 200, 0);
        var out = [];
        for (var i = 0; i < recs.length; i++) out.push(h.schedulePayload(recs[i]));
        e.json(200, { ok: true, schedules: out, count: out.length });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// create | update | delete | toggle | runNow
routerAdd("POST", "/gws/bulk/schedules", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "POST, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var t = h.getUserConfig(e, u.id); if (!t) return;
    var b = JSON.parse(toString(e.request.body));
    var act = b.action || "create";
    try {
        var coll = $app.findCollectionByNameOrId("bulkSchedules");

        if (act === "delete") {
            if (!b.id) { e.json(400, { error: "id required" }); return; }
            var del = $app.findRecordById("bulkSchedules", b.id);
            $app.delete(del);
            h.auditLog(u.id, "schedule.delete", u.email || u.id, { id: b.id, title: del.get("title") });
            e.json(200, { ok: true, action: "deleted", id: b.id }); return;
        }

        var rec;
        if (b.id) {
            rec = $app.findRecordById("bulkSchedules", b.id);
        } else {
            rec = new Record(coll);
            rec.set("createdBy", u.id);
            rec.set("runCount", 0);
            rec.set("successRuns", 0);
            rec.set("failedRuns", 0);
            rec.set("appliedUsers", 0);
            rec.set("failedUsers", 0);
            rec.set("enabled", true);
        }

        if (act === "toggle") {
            rec.set("enabled", !rec.get("enabled"));
            $app.save(rec);
            e.json(200, { ok: true, action: "toggled", schedule: h.schedulePayload(rec) }); return;
        }

        if (act === "create" || act === "update") {
            if (!b.title || !String(b.title).trim()) { e.json(400, { error: "title required" }); return; }
            var html = (typeof b.html === "string") ? b.html : "";
            var hasHtml = !!html.trim();
            var tid = b.templateId || "";
            if (!hasHtml && !tid) {
                e.json(400, { error: "a signature is required (editor content or a saved template)" }); return;
            }
            if (tid) {
                try { $app.findRecordById("signatureTemplates", tid); }
                catch (_) { e.json(404, { error: "template_not_found" }); return; }
            }
            var sel = b.selector || {};
            if (!h.asArray(sel.orgUnits).length && !h.asArray(sel.groups).length &&
                !h.asArray(sel.manual).length && !String(sel.query || "").trim()) {
                e.json(400, { error: "an audience is required (organisational unit, group, filter or manual list)" }); return;
            }

            rec.set("title", String(b.title).trim());
            rec.set("description", b.description || "");
            rec.set("templateId", tid);
            if (hasHtml) rec.set("htmlOverride", html);
            rec.set("selector", sel);
            rec.set("freq", b.freq || "daily");
            rec.set("time", b.time || "09:00");
            rec.set("weekdays", h.asArray(b.weekdays));
            rec.set("dayOfMonth", b.dayOfMonth || 1);
            rec.set("intervalMinutes", b.intervalMinutes || 60);
            rec.set("tzOffsetMinutes", (typeof b.tzOffsetMinutes === "number") ? b.tzOffsetMinutes : 0);
            rec.set("timezone", b.timezone || "");
            if (b.startsAt) { try { rec.set("startsAt", new Date(b.startsAt)); } catch (_) {} }
            if (typeof b.enabled === "boolean") rec.set("enabled", b.enabled);

            // next run is computed from the rule that was just saved
            var probe = {
                freq: rec.get("freq"), time: rec.get("time"),
                weekdays: h.asArray(rec.get("weekdays")),
                dayOfMonth: rec.get("dayOfMonth"),
                intervalMinutes: rec.get("intervalMinutes"),
                startsAt: rec.get("startsAt"),
                lastRunAt: rec.get("lastRunAt"),
                tzOffsetMinutes: rec.get("tzOffsetMinutes")
            };
            var nxt = h.nextRunAfter(probe, Date.now());
            rec.set("nextRunAt", nxt ? new Date(nxt) : null);

            $app.save(rec);
            h.auditLog(u.id, "schedule." + act, u.email || u.id,
                { id: rec.id, title: rec.get("title"), freq: rec.get("freq"), time: rec.get("time") });
            e.json(200, { ok: true, action: act, schedule: h.schedulePayload(rec) }); return;
        }

        if (act === "runNow") {
            if (!b.id) { e.json(400, { error: "id required" }); return; }
            rec = $app.findRecordById("bulkSchedules", b.id);
            var emails = h.resolveAudience(h.asObject(rec.get("selector")), t);
            if (!emails.length) { e.json(400, { error: "audience is empty", count: 0 }); return; }
            var jobColl = $app.findCollectionByNameOrId("bulkJobs");
            var job = new Record(jobColl);
            job.set("status", "running");
            job.set("selector", h.asObject(rec.get("selector")));
            job.set("emails", emails);
            job.set("total", emails.length);
            job.set("done", 0);
            job.set("failed", []);
            job.set("chunkSize", 25);
            job.set("dryRun", false);
            job.set("scheduleId", rec.id);
            job.set("createdBy", u.id);
            job.set("startedAt", new Date());
            var jh = h.asString(rec.get("htmlOverride"));
            if (jh.trim()) job.set("htmlOverride", jh);
            if (rec.get("templateId")) job.set("templateId", rec.get("templateId"));
            $app.save(job);

            rec.set("lastJobId", job.id);
            rec.set("lastRunAt", new Date());
            rec.set("lastStatus", "queued");
            rec.set("lastRecipients", emails.length);
            // a manual run is still an execution, so it counts
            rec.set("runCount", (rec.get("runCount") || 0) + 1);
            $app.save(rec);
            h.auditLog(u.id, "schedule.runNow", u.email || u.id, { id: rec.id, title: rec.get("title"), jobId: job.id, total: emails.length });
            e.json(200, { ok: true, action: "runNow", jobId: job.id, total: emails.length }); return;
        }

        e.json(400, { error: "unknown action" });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Recent jobs produced by one schedule, for its run history.
routerAdd("GET", "/gws/bulk/schedule-runs", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    var id = e.request.url.query().get("id");
    if (!id) { e.json(400, { error: "id required" }); return; }
    try {
        var recs = $app.findRecordsByFilter("bulkJobs",
            'scheduleId = "' + String(id).replace(/"/g, '\\"') + '"', "-startedAt", 20, 0);
        var runs = [];
        for (var i = 0; i < recs.length; i++) {
            var r = recs[i];
            var failed = h.asArray(r.get("failed"));
            runs.push({
                jobId: r.id,
                status: r.get("status"),
                total: r.get("total") || 0,
                done: r.get("done") || 0,
                failedCount: failed.length,
                startedAt: r.get("startedAt"),
                finishedAt: r.get("finishedAt") || null,
                lastError: r.get("lastError") || ""
            });
        }
        e.json(200, { ok: true, runs: runs, count: runs.length });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// List recent bulk jobs.
//
// Before this existed there was no way to enumerate jobs at all: the only read
// route was /gws/bulk/status, which needs an id, and the UI kept that id in a
// page variable. Reloading the tab lost the job permanently.
//
// NOTE ON ACCESS: `users.role` (owner/admin/member) exists in the schema but is
// not enforced anywhere in this build, so this follows the same model as every
// other route: any authenticated user sees the jobs. If role enforcement is
// added later, this is one of the routes that should respect it.
routerAdd("GET", "/gws/bulk/jobs", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    try {
        var q = e.request.url.query();
        var limit = parseInt(q.get("limit") || "25", 10);
        if (isNaN(limit) || limit < 1) limit = 25;
        if (limit > 100) limit = 100;
        var offset = parseInt(q.get("offset") || "0", 10);
        if (isNaN(offset) || offset < 0) offset = 0;

        var total = $app.countRecords("bulkJobs");
        var recs = $app.findRecordsByFilter("bulkJobs", "", "-startedAt", limit, offset);

        var jobs = [];
        for (var i = 0; i < recs.length; i++) {
            var r = recs[i];
            var failed = h.asArray(r.get("failed"));
            var totalN = r.get("total") || 0;
            var doneN = r.get("done") || 0;
            // owner email, best-effort: the user may have been deleted
            var who = "";
            try {
                var owner = $app.findRecordById("users", r.get("createdBy"));
                who = owner.get("email") || r.get("createdBy") || "";
            } catch (_) { who = r.get("createdBy") || ""; }
            jobs.push({
                jobId: r.id,
                status: r.get("status"),
                total: totalN,
                done: doneN,
                failedCount: failed.length,
                dryRun: !!r.get("dryRun"),
                startedAt: r.get("startedAt"),
                finishedAt: r.get("finishedAt") || null,
                createdBy: who,
                pct: totalN ? Math.round((doneN / totalN) * 100) : 0,
                etaMs: (r.get("avgMsPerUser") || 0) * Math.max(0, totalN - doneN),
                retries: r.get("retries") || 0,
                rateLimited: r.get("rateLimited") || 0,
                throttledMs: r.get("throttledMs") || 0,
                stallCount: r.get("stallCount") || 0,
                lastError: r.get("lastError") || ""
            });
        }
        e.json(200, { ok: true, total: total, limit: limit, offset: offset, jobs: jobs });
    } catch (err) { e.json(500, { error: "internal_error", message: err.message }); }
});

// Paged view of one job's failures.
//
// /gws/bulk/status truncates `failed` at 100 rows, which silently hides the
// rest of a bad run. This returns the full list in pages.
routerAdd("GET", "/gws/bulk/failures", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var u = h.authUser(e); if (!u) return;
    try {
        var q = e.request.url.query();
        var id = q.get("id");
        if (!id) { e.json(400, { error: "id required" }); return; }
        var limit = parseInt(q.get("limit") || "100", 10);
        if (isNaN(limit) || limit < 1) limit = 100;
        if (limit > 500) limit = 500;
        var offset = parseInt(q.get("offset") || "0", 10);
        if (isNaN(offset) || offset < 0) offset = 0;

        var rec = $app.findRecordById("bulkJobs", id);
        var all = h.asArray(rec.get("failed"));
        var page = all.slice(offset, offset + limit);
        e.json(200, { ok: true, jobId: rec.id, total: all.length,
            limit: limit, offset: offset, items: page });
    } catch (err) { e.json(404, { error: "job_not_found", message: err.message }); }
});

routerAdd("GET", "/frontend/{path...}", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var path = e.pathParams().path;
    $apis.static(__hooks + "/../frontend", false)(e);
});
