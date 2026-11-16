/// <reference path="../pb_data/types.d.ts" />
// Scheduled vacation auto-responder pushes.
migrate((app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("vacationSchedules");
  } catch (_) {
    coll = null;
  }
  if (coll) return;

  coll = new Collection({
    type: "base",
    name: "vacationSchedules",
    fields: [
      { name: "userEmail", type: "text", required: true },
      // pending | sent | failed | cancelled
      { name: "status", type: "text", required: true },
      { name: "pushAt", type: "date", required: true },
      { name: "payload", type: "json", maxSize: 131072 },
      { name: "lastError", type: "text" },
      { name: "createdBy", type: "text" },
      { name: "sentAt", type: "date" },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE INDEX idx_vacSched_status_pushAt ON vacationSchedules (status, pushAt)",
      "CREATE INDEX idx_vacSched_userEmail ON vacationSchedules (userEmail)",
    ],
  });

  app.save(coll);
}, (app) => {
  try {
    const coll = app.findCollectionByNameOrId("vacationSchedules");
    if (coll) app.delete(coll);
  } catch (_) {}
});
