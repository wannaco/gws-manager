/// <reference path="../pb_data/types.d.ts" />
// Scheduled signature applies.
//
// A schedule describes WHAT to apply (a signature + an audience selector) and
// WHEN (a recurrence rule). The gws-scheduler cron turns a due schedule into a
// buloJob, which the existing gws-bulk-worker then drains -- so all the batching,
// retry, resume and progress machinery is reused rather than duplicated.
//
// TIMEZONE: the JSVM has no Intl, so IANA zones cannot be resolved on the
// server. A schedule stores the UTC offset the browser reported
// (`tzOffsetMinutes`) and all recurrence maths is done in local = utc + offset.
// `timezone` is kept for display only. Exact for zones without DST; an hour out
// for zones with it, which is documented rather than hidden.
migrate((app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("bulkSchedules");
  } catch (_) {
    coll = null;
  }
  if (coll) return;

  coll = new Collection({
    type: "base",
    name: "bulkSchedules",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "enabled", type: "bool" },

      // what to apply
      { name: "templateId", type: "text" },
      { name: "htmlOverride", type: "editor", maxSize: 500000 },
      { name: "selector", type: "json", maxSize: 65536 },

      // when
      // once | daily | weekly | monthly | interval
      { name: "freq", type: "text" },
      { name: "time", type: "text" },          // "HH:MM" local
      { name: "weekdays", type: "json", maxSize: 1024 },   // [0..6], 0 = Sunday
      { name: "dayOfMonth", type: "number" },
      { name: "intervalMinutes", type: "number" },
      { name: "startsAt", type: "date" },
      { name: "tzOffsetMinutes", type: "number" },
      { name: "timezone", type: "text" },      // display only

      // state
      { name: "nextRunAt", type: "date" },
      { name: "lastRunAt", type: "date" },
      { name: "lastStatus", type: "text" },
      { name: "lastError", type: "text" },
      { name: "lastJobId", type: "text" },
      { name: "lastRecipients", type: "number" },

      // execution counters
      { name: "runCount", type: "number" },
      { name: "successRuns", type: "number" },
      { name: "failedRuns", type: "number" },
      { name: "appliedUsers", type: "number" },
      { name: "failedUsers", type: "number" },

      { name: "createdBy", type: "text" },
    ],
    // Server-side only: all access goes through /gws/bulk/schedules, which
    // authenticates the app user itself.
    listRule: null, viewRule: null, createRule: null,
    updateRule: null, deleteRule: null,
    indexes: [
      "CREATE INDEX idx_bulkSchedules_enabled ON bulkSchedules (enabled)",
      "CREATE INDEX idx_bulkSchedules_nextRun ON bulkSchedules (nextRunAt)",
    ],
  });
  app.save(coll);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("bulkSchedules");
    if (c) app.delete(c);
  } catch (_) {}
});
