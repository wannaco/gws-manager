/// <reference path="../pb_data/types.d.ts" />
// =============================================================================
// Optional PocketBase superuser from the environment
//
// This creates the DASHBOARD account (/_/), not an app login. App logins live in
// the `users` collection and the first one is made through the app itself.
//
// Why it exists: with public signup closed (1786000070_lock_signup.js) a fresh
// install has no way into the dashboard except clicking the one-time install
// link that PocketBase prints at first boot. The README used to tell people to
// "register with your domain email", which silently relied on public signup.
// Setting these two vars makes the dashboard account deterministic at boot.
//
//   GWS_ADMIN_EMAIL      e.g. admin@example.com
//   GWS_ADMIN_PASSWORD   8+ characters
//
// Leave either blank to skip. Nothing is created if a superuser with that email
// already exists, so this is safe to leave set on every boot.
//
// NOTE this is NOT the app's admin role. `_superusers` is infrastructure access
// (schema, backups, recovery, break-glass); it cannot be used for Google SSO
// because PocketBase hard-disables OAuth2 on system collections. The app-level
// role lives on `users` — see the app-roles migration for that.
// =============================================================================
migrate((app) => {
  const email = String($os.getenv("GWS_ADMIN_EMAIL") || "").trim().toLowerCase();
  const password = $os.getenv("GWS_ADMIN_PASSWORD") || "";

  if (!email || !password) {
    console.log("[gws-manager] no GWS_ADMIN_EMAIL/GWS_ADMIN_PASSWORD set; " +
      "leaving superusers alone");
    return;
  }
  if (password.length < 8) {
    console.log("[gws-manager] GWS_ADMIN_PASSWORD is shorter than 8 characters; " +
      "refusing to create the superuser");
    return;
  }

  // Already there? Leave it alone — never overwrite an existing password.
  try {
    app.findAuthRecordByEmail("_superusers", email);
    console.log("[gws-manager] superuser already exists, unchanged: " + email);
    return;
  } catch (_) { /* not found — create it below */ }

  try {
    const coll = app.findCollectionByNameOrId("_superusers");
    const su = new Record(coll, { email: email, verified: true });
    su.setPassword(password);
    app.save(su);
    console.log("[gws-manager] superuser created from env: " + email);
  } catch (err) {
    console.log("[gws-manager] could not create the env superuser: " +
      ((err && err.message) || err));
  }
}, (app) => {
  // Downgrade: leave the superuser in place. Removing an account on rollback
  // could lock the operator out of their own dashboard.
});
