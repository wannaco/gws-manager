/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Create tenants collection
  const tenants = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {"name": "domain", "type": "text", "system": false, "required": false},
      {"name": "adminEmail", "type": "email", "system": false, "required": false},
      {"name": "serviceAccountKey", "type": "json", "system": false, "required": false},
      {"name": "gcpProjectId", "type": "text", "system": false, "required": false},
      {"name": "webhookUrl", "type": "url", "system": false, "required": false},
      {"name": "plan", "type": "select", "system": false, "required": false, "values": ["free", "basic", "pro", "business", "enterprise"]},
      {"name": "tier", "type": "select", "system": false, "required": false, "values": ["free", "basic", "pro", "business", "enterprise"]},
      {"name": "suspended", "type": "bool", "system": false, "required": false},
      {"name": "branding", "type": "json", "system": false, "required": false},
      {"name": "subscriptionStatus", "type": "text", "system": false, "required": false}
    ],
    "indexes": [],
    "listRule": null,
    "name": "tenants",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  // Create tenant_users collection
  const tenantUsers = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210257",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {"name": "userId", "type": "text", "system": false, "required": false},
      {"name": "email", "type": "email", "system": false, "required": false},
      {"name": "displayName", "type": "text", "system": false, "required": false},
      {"name": "role", "type": "select", "system": false, "required": false, "values": ["owner", "admin", "member"]}
    ],
    "indexes": [],
    "listRule": null,
    "name": "tenant_users",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  // Create signatureTemplates collection
  const sigTemplates = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210258",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {"name": "name", "type": "text", "system": false, "required": false},
      {"name": "html", "type": "editor", "system": false, "required": false},
      {"name": "updatedBy", "type": "text", "system": false, "required": false}
    ],
    "indexes": [],
    "listRule": null,
    "name": "signatureTemplates",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  app.save(tenants);
  app.save(tenantUsers);
  app.save(sigTemplates);
}, (app) => {
  // Revert: delete all three
  const t = app.findCollectionByNameOrId("tenants");
  const tu = app.findCollectionByNameOrId("tenant_users");
  const st = app.findCollectionByNameOrId("signatureTemplates");
  if (t) app.delete(t);
  if (tu) app.delete(tu);
  if (st) app.delete(st);
})
