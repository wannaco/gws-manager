/// <reference path="../pb_data/types.d.ts" />
// =============================================================================
// Application roles: users.role = "user" | "admin"
//
// Two SEPARATE systems, deliberately:
//
//   _superusers  infrastructure — the dashboard at /_/, schema, backups,
//                recovery, and break-glass CLI access. Cannot use OAuth
//                (PocketBase disables it on system collections), so it is a
//                password account and always will be.
//
//   users.role   the APPLICATION role — what someone may do inside the app.
//                Ordinary `users` records, so Google SSO works.
//
// Why the app needs its own role at all: without it, every account that can sign
// in is a full administrator. `authUser()` accepts any authenticated record, so a
// helpdesk user could add themselves as a Gmail delegate on the CEO's mailbox —
// reading their mail — or mass-apply to the whole domain.
//
//   role = "user"   helpdesk / junior operator. Can look things up, read job
//                   history, and manage signature content. Cannot change who has
//                   access to a mailbox, cannot impersonate anyone, cannot run a
//                   domain-wide bulk operation, cannot touch the service-account
//                   key or the audit webhook.
//   role = "admin"  everything.
//
// WHICH ROUTES EACH ROLE MAY CALL is enforced in hooks/main.pb.js via
// h.requireAdmin(). The mapping is asserted end-to-end by test_roles.py, which
// enumerates every route — so a new route that forgets a guard fails the test
// rather than shipping open.
//
// IMPORTANT — why this migration promotes rather than defaults:
// the field defaults to "user", which is the safe direction for NEW accounts.
// On an install that already has users, that same default would demote the
// operator and lock them out of their own instance. So this also promotes, once:
//   (a) every superuser gets a matching users record with role=admin, so admins
//       can use Google SSO and behave like normal teammates; and
//   (b) if nothing is an admin afterwards, the OLDEST user is promoted, which
//       guarantees an existing install keeps at least one way in.
// =============================================================================
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users) return;

  // 1) the field
  if (!users.fields.getByName("role")) {
    users.fields.addMarshaledJSON(JSON.stringify([{
      name: "role",
      type: "select",
      values: ["user", "admin"],
      maxSelect: 1,
      required: false
    }]));
    app.save(users);
    console.log("[gws-manager] users.role added (user|admin)");
  } else {
    console.log("[gws-manager] users.role already present");
  }

  // 2) mirror superusers -> admin app users, so admins get SSO
  let supers = [];
  try { supers = app.findRecordsByFilter("_superusers", "", "", 0, 0) || []; } catch (_) { supers = []; }

  let created = 0, promoted = 0, skipped = 0;
  for (const su of supers) {
    const email = String(su.getString("email") || "").trim().toLowerCase();
    // PocketBase's own first-boot placeholder is not a person.
    if (!email || email.indexOf("__pbinstaller") === 0) { skipped++; continue; }
    try {
      let rec = null;
      try {
        const found = app.findRecordsByFilter("users", "email = {:e}", "", 1, 0, { e: email });
        rec = (found && found.length) ? found[0] : null;
      } catch (_) { rec = null; }

      if (rec) {
        if (String(rec.getString("role") || "") !== "admin") {
          rec.set("role", "admin");
          app.save(rec);
          promoted++;
        }
      } else {
        const u = new Record(users, { email: email, name: su.getString("name") || "Admin",
                                      role: "admin", verified: true });
        // `users` is an auth collection so a password is mandatory. Long random
        // throwaway: the admin signs in with Google (or sets a real password).
        u.setPassword($security.randomString(32));
        app.save(u);
        created++;
      }
    } catch (err) {
      console.log("[gws-manager] role bootstrap skipped for " + email + ": " + ((err && err.message) || err));
    }
  }

  // 3) lockout guard — an existing install must keep at least one way in
  let admins = 0;
  try { admins = app.countRecords("users", "role = 'admin'"); } catch (_) { admins = 0; }

  let fallback = "";
  if (admins === 0) {
    try {
      const oldest = app.findRecordsByFilter("users", "", "+created", 1, 0);
      if (oldest && oldest.length) {
        oldest[0].set("role", "admin");
        app.save(oldest[0]);
        fallback = String(oldest[0].getString("email") || oldest[0].id);
        console.log("[gws-manager] no admin existed; promoted the oldest user: " + fallback);
      }
    } catch (err) {
      console.log("[gws-manager] could not promote a fallback admin: " + ((err && err.message) || err));
    }
  }

  console.log("[gws-manager] roles ready: " + created + " admin user(s) created, " +
    promoted + " promoted, " + skipped + " placeholder skipped" +
    (fallback ? ", fallback admin " + fallback : ""));
}, (app) => {
  // Downgrade: leave the field and the roles in place. Removing the field would
  // silently make every account a "user" on the next boot, which is a lockout.
});
