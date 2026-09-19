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
    // Try local cache first
    try {
        var filter = q ? 'name ~ "' + q.replace(/"/g, '\\"') + '" || primaryEmail ~ "' + q.replace(/"/g, '\\"') + '"' : "";
        var cached = $app.findRecordsByFilter("domainUsers", filter, "+primaryEmail", 500, 0);
        if (cached && cached.length > 0) {
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
            e.json(200, { ok: true, users: users, nextPageToken: null, fromCache: true });
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
            h.googleApiCall(sa, b.userEmail, sc, "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(b.userEmail) + "/settings/sendAs/" + encodeURIComponent(te), "PATCH", { signature: html });
            h.auditLog(u.id, "signature.update", u.email || u.id, { userEmail: b.userEmail, sendAsEmail: te });
            e.json(200, { ok: true, action: "updated", sendAsEmail: te }); return;
        }
        if (act === "bulkApply") {
            if (!b.templateId || !b.userEmails || !Array.isArray(b.userEmails) || b.userEmails.length === 0) {
                e.json(400, { error: "templateId and userEmails[] required" }); return;
            }
            var tmpl;
            try { tmpl = $app.findRecordById("signatureTemplates", b.templateId); } catch (_) { e.json(404, { error: "template_not_found" }); return; }
            var thtml = tmpl.get("html") || "";
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
                    h.googleApiCall(sa, email, sc, "https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(email) + "/settings/sendAs/" + encodeURIComponent(email), "PATCH", { signature: html });
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
        var r = h.googleApiCall(sa, ae, ["https://www.googleapis.com/auth/admin.directory.group.readonly"],
            "https://admin.googleapis.com/admin/directory/v1/groups/" + encodeURIComponent(ge) + "/members?maxResults=500");
        var ms = (r.members || []).filter(function(m) { return m.type === "USER" && m.email; })
            .map(function(m) { return { email: m.email, role: m.role || "MEMBER" }; });
        e.json(200, { ok: true, members: ms });
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
routerAdd("GET", "/frontend/{path...}", (e) => {
    var h = require(__hooks + "/../lib/helpers.js");
    if (h.addCorsHeaders(e, "GET, OPTIONS")) return;
    var path = e.pathParams().path;
    $apis.static(__hooks + "/../frontend", false)(e);
});
