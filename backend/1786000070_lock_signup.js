/// <reference path="../pb_data/types.d.ts" />
// =============================================================================
// Lock down public account creation
//
// PocketBase gives a fresh `users` collection `createRule = ""` — an EMPTY
// STRING, which in PocketBase means PUBLIC. Nothing in this repo ever changed
// it, so on a published instance anyone who could reach the login page could:
//
//     POST /api/collections/users/records   -> 200, account created
//     POST /api/collections/users/auth-with-password  -> 200, logged in
//
// and authUser() accepts any authenticated record, so that account was a full
// app user with access to every /gws/* route — domain config, the service
// account key, bulk apply, the lot.
//
// On a NEW deployment it is worse than open: registration is unauthenticated, so
// the first stranger to reach the URL could claim the instance before the
// operator ever did.
//
// Fix: NULL = superuser-only, so the public REST route can no longer create
// users. The first account is created through POST /gws/bootstrap instead, which
// only works while the collection is empty (see hooks/main.pb.js). After that,
// further accounts are provisioned from the PocketBase dashboard.
//
// Setting the rule here rather than in the UI matters: the previous behaviour was
// PocketBase's default, so a fresh install silently re-opened it.
// =============================================================================
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users) return;

  const before = users.createRule;
  users.createRule = null;
  app.save(users);
  console.log("[gws-manager] users.createRule locked (" +
    JSON.stringify(before) + " -> null); public signup disabled, " +
    "first account comes from POST /gws/bootstrap");
}, (app) => {
  // Downgrade: put PocketBase's default back.
  const users = app.findCollectionByNameOrId("users");
  if (!users) return;
  users.createRule = "";
  app.save(users);
  console.log("[gws-manager] users.createRule restored to public");
});
