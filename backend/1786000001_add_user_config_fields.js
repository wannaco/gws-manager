/// <reference path="../pb_data/types.d.ts" />
// Add the per-install configuration fields to the `users` collection.
//
// A self-hosted deployment = one Google Workspace domain, and that domain's
// configuration (domain, admin email, service-account key, GCP project,
// webhook) is stored on the authenticated user's own record. getUserConfig()
// and every /gws/* route read and write these fields on `users`.
//
// The legacy `tenants` collection (created by 1780355000_init_collections) has
// equivalent fields, but nothing in the app references `tenants` any more, so
// without this migration a fresh install silently discards everything saved
// during setup (PocketBase ignores set() on a non-existent field).
migrate((app) => {
  const coll = app.findCollectionByNameOrId("users");
  if (!coll) return;

  if (!coll.fields.getByName("domain")) {
    coll.fields.add(new TextField({ name: "domain", required: false }));
  }
  if (!coll.fields.getByName("adminEmail")) {
    coll.fields.add(new EmailField({ name: "adminEmail", required: false }));
  }
  if (!coll.fields.getByName("serviceAccountKey")) {
    coll.fields.add(new JSONField({ name: "serviceAccountKey", required: false }));
  }
  if (!coll.fields.getByName("gcpProjectId")) {
    coll.fields.add(new TextField({ name: "gcpProjectId", required: false }));
  }
  if (!coll.fields.getByName("webhookUrl")) {
    coll.fields.add(new URLField({ name: "webhookUrl", required: false }));
  }

  app.save(coll);
}, (app) => {
  const coll = app.findCollectionByNameOrId("users");
  if (!coll) return;

  ["domain", "adminEmail", "serviceAccountKey", "gcpProjectId", "webhookUrl"].forEach((name) => {
    if (coll.fields.getByName(name)) coll.fields.remove(name);
  });

  app.save(coll);
});
