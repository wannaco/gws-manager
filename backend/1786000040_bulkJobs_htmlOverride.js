/// <reference path="../pb_data/types.d.ts" />
// Carry the signature HTML on the job itself.
//
// Bulk apply used to POST the editor content to /gws/signature-templates as a
// new template named "BulkTemp" every single run, purely so the worker had an
// id to read. That left a pile of identical BulkTemp rows behind, with no way to
// remove them, and it meant the job broke if the template was later deleted.
//
// The html now travels with the job. A templateId is still accepted (applying a
// saved template still works), but it is no longer required.
migrate((app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("bulkJobs");
  } catch (_) {
    return;
  }
  if (!coll.fields.getByName("htmlOverride")) {
    coll.fields.add(new Field({
      name: "htmlOverride",
      type: "editor",
      maxSize: 500000,
    }));
    app.save(coll);
  }
}, (app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("bulkJobs");
  } catch (_) {
    return;
  }
  const f = coll.fields.getByName("htmlOverride");
  if (f) { coll.fields.removeById(f.id); app.save(coll); }
});
