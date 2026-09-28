/// <reference path="../pb_data/types.d.ts" />
// =============================================================================
// Ensure the dashboard superuser matches GWS_ADMIN_EMAIL / GWS_ADMIN_PASSWORD
//
// Why this exists as a SEPARATE migration from 1786000071 (which only creates):
//
// That migration is create-if-missing, deliberately, so it never overwrites a
// password someone changed on purpose. The consequence is that once a superuser
// exists, changing GWS_ADMIN_PASSWORD does NOTHING — which is exactly the trap
// that leaves an operator locked out of /_/ with no way back in, because
// `_superusers` cannot use OAuth (PocketBase disables it on system collections)
// and the one-time install link from first boot has long expired.
//
// So this one UPSERTS: it creates the account if absent, and RESETS the password
// if it is present. It runs once (migrations are recorded), which is what makes
// it safe to re-run on demand: add a new migration when you need another reset,
// or use `pocketbase superuser upsert EMAIL PASS` on the host.
//
// Why not a boot hook: `onBootstrap` PANICS on any database access in both
// 0.39 and 0.40 ("invalid memory address or nil pointer dereference", crashing
// the server at startup), and PocketBase exposes no `onServe`/`onAfterBootstrap`
// in this JSVM — verified by probe. A migration is the only reliable point at
// which the database is ready.
//
// Leave both vars blank to skip entirely (the default).
// =============================================================================
migrate((app) => {
  const email = String($os.getenv("GWS_ADMIN_EMAIL") || "").trim().toLowerCase();
  const password = $os.getenv("GWS_ADMIN_PASSWORD") || "";

  if (!email || !password) {
    console.log("[gws-manager] no GWS_ADMIN_EMAIL/GWS_ADMIN_PASSWORD; superuser untouched");
    return;
  }
  if (password.length < 8) {
    console.log("[gws-manager] GWS_ADMIN_PASSWORD is shorter than 8 characters; refusing to apply it");
    return;
  }

  // Already correct? (same email present) -> reset the password.
  let existing = null;
  try { existing = app.findAuthRecordByEmail("_superusers", email); } catch (_) { existing = null; }

  if (existing) {
    existing.setPassword(password);
    app.save(existing);
    console.log("[gws-manager] superuser password SET from env: " + email);
    return;
  }

  try {
    const coll = app.findCollectionByNameOrId("_superusers");
    const su = new Record(coll, { email: email, verified: true });
    su.setPassword(password);
    app.save(su);
    console.log("[gws-manager] superuser CREATED from env: " + email);
  } catch (err) {
    console.log("[gws-manager] could not create the env superuser: " + ((err && err.message) || err));
  }
}, (app) => {
  // Downgrade: leave the account alone. Removing a superuser on rollback could
  // lock the operator out of their own dashboard.
});
