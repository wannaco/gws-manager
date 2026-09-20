/// <reference path="../pb_data/types.d.ts" />
// Link a bulk job back to the schedule that created it, so the schedule's
// execution counters can be updated when the job finishes.
migrate((app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("bulkJobs");
  } catch (_) {
    return;
  }
  if (!coll.fields.getByName("scheduleId")) {
    coll.fields.add(new Field({ name: "scheduleId", type: "text" }));
    app.save(coll);
  }
}, (app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("bulkJobs");
  } catch (_) {
    return;
  }
  const f = coll.fields.getByName("scheduleId");
  if (f) { coll.fields.removeById(f.id); app.save(coll); }
});
