// GET  /api/jobs           -> list jobs
// POST /api/jobs {name}    -> create a job, returns the new job record
import { json, badRequest, serverError, newId, readJSON, writeJSON, parseBody } from './lib/_lib.mjs';

const INDEX_KEY = 'jobs/index.json';

export default async (req) => {
  try {
    if (req.method === 'GET') {
      const jobs = await readJSON(INDEX_KEY, []);
      return json(200, { jobs });
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

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
