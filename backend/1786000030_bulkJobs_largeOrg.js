/// <reference path="../pb_data/types.d.ts" />
// Extra fields on bulkJobs needed to run reliably against LARGE domains.
//
//   lockedAt      worker holds this job for the duration of a tick, so a tick
//                 that overruns its 60s slot cannot be re-entered by the next
//                 one and re-apply the same users.
//   dryRun        resolve + render everything, call nothing. The only way to
//                 preview a run against a production domain.
//   retries       how many 429/5xx retries have been performed (surfaced in UI)
//   rateLimited   how many 429s were seen — the signal that Google is throttling
//   throttledMs   total time spent sleeping in backoff
//   avgMsPerUser  measured cost per user, used to show an ETA
//   maxPerTick    hard ceiling on users per tick, independent of the time budget
//
// Added as a separate migration because 1786000020 has already been applied on
// existing installs; editing it in place would not run again.
migrate((app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("bulkJobs");
  } catch (_) {
    return;   // collection not present (fresh install runs 1786000020 first)
  }

  const want = [
    { name: "lockedAt", type: "date" },
    { name: "dryRun", type: "bool" },
    { name: "retries", type: "number" },
    { name: "rateLimited", type: "number" },
    { name: "throttledMs", type: "number" },
    { name: "avgMsPerUser", type: "number" },
    { name: "maxPerTick", type: "number" },
  ];

  let changed = false;
  for (const spec of want) {
    if (!coll.fields.getByName(spec.name)) {
      coll.fields.add(new Field(spec));
      changed = true;
    }
  }
  if (changed) app.save(coll);
}, (app) => {
  let coll;
  try {
    coll = app.findCollectionByNameOrId("bulkJobs");
  } catch (_) {
    return;
  }
  for (const n of ["lockedAt", "dryRun", "retries", "rateLimited",
                   "throttledMs", "avgMsPerUser", "maxPerTick"]) {
    const f = coll.fields.getByName(n);
    if (f) coll.fields.removeById(f.id);
  }
  app.save(coll);
});
