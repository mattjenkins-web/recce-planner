// GET    /api/jobs           -> list jobs, each with its location/photo counts
// POST   /api/jobs {name}    -> create a job, returns the new job record
// DELETE /api/jobs?id=xxx    -> remove a job from the list (e.g. test data)
import { json, badRequest, notFound, serverError, newId, readJSON, writeJSON, parseBody } from './lib/_lib.mjs';

const INDEX_KEY = 'jobs/index.json';

export default async (req) => {
  try {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const jobs = await readJSON(INDEX_KEY, []);
      // The index only stores {id, name, createdAt} — location/photo counts
      // live in each job's own files, so they're filled in here for display.
      const enriched = await Promise.all(jobs.map(async (job) => {
        const locations = await readJSON(`jobs/${job.id}/locations.json`, []);
        const perLocationPhotos = await Promise.all(
          locations.map((loc) => readJSON(`jobs/${job.id}/locations/${loc.id}/photos.json`, []))
        );
        const photoCount = perLocationPhotos.reduce((sum, list) => sum + list.length, 0);
        return { ...job, locationCount: locations.length, photoCount };
      }));
      return json(200, { jobs: enriched });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      if (!name) return badRequest('A job name is required.');

      const jobs = await readJSON(INDEX_KEY, []);
      const job = { id: newId('job'), name, createdAt: new Date().toISOString() };
      jobs.push(job);
      await writeJSON(INDEX_KEY, jobs);
      // Every job starts with an empty locations list.
      await writeJSON(`jobs/${job.id}/locations.json`, []);
      return json(201, { job });
    }

    if (req.method === 'DELETE') {
      const body = await parseBody(req).catch(() => ({}));
      const id = url.searchParams.get('id') || body.id;
      if (!id) return badRequest('id is required.');
      const jobs = await readJSON(INDEX_KEY, []);
      const next = jobs.filter((j) => j.id !== id);
      if (next.length === jobs.length) return notFound('Job not found.');
      await writeJSON(INDEX_KEY, next);
      // Leaves the job's own location/photo files and blobs in place —
      // harmless orphaned data, not worth the extra round trips to sweep up.
      return json(200, { deleted: id });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
