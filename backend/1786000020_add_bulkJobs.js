/// <reference path="../pb_data/types.d.ts" />
// Bulk signature apply jobs.
//
// A bulk apply over a large domain cannot run inside one HTTP request: it is one
// Google API call per user, sequentially. This collection is the queue entry.
//
// POST /gws/bulk/start resolves the audience and writes one record with
// status="running"; the gws-bulk-worker cron (hooks/main.pb.js) then drains it
// one chunk per minute tick, updating `done`/`failed`. Because the progress lives
// on the record, an interrupted run resumes on the next tick instead of being lost.
migrate((app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("bulkJobs");
  } catch (_) {
    coll = null;
  }
  if (coll) return;

  coll = new Collection({
    type: "base",
    name: "bulkJobs",
    fields: [
      // queued | running | done | failed
      { name: "status", type: "text", required: true },
      // the audience selector as submitted, for display/re-run
      { name: "selector", type: "json", maxSize: 65536 },
      // resolved recipient addresses
      { name: "emails", type: "json", maxSize: 20000000 },
      { name: "templateId", type: "text" },
      { name: "total", type: "number" },
      { name: "done", type: "number" },
      // [{ email, error }]
      { name: "failed", type: "json", maxSize: 20000000 },
      { name: "chunkSize", type: "number" },
      // owner (the app user that started it)
      { name: "createdBy", type: "text" },
      { name: "startedAt", type: "date" },
      { name: "finishedAt", type: "date" },
      { name: "lastError", type: "text" },
    ],
    // Server-side only: no client rules. All access goes through /gws/bulk/*
    // routes which authenticate the app user themselves.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: ["CREATE INDEX idx_bulkJobs_status ON bulkJobs (status)"],
  });

  app.save(coll);
}, (app) => {
  try {
    const coll = app.findCollectionByNameOrId("bulkJobs");
    if (coll) app.delete(coll);
  } catch (_) {}
});
