// GET  /api/locations?jobId=xxx          -> list locations for a job
// POST /api/locations {jobId, name}      -> add a location to a job
import { json, badRequest, notFound, serverError, newId, readJSON, writeJSON, parseBody } from './lib/_lib.mjs';

export default async (req) => {
  try {
    const url = new URL(req.url);
    const jobIdQ = url.searchParams.get('jobId');

    if (req.method === 'GET') {
      if (!jobIdQ) return badRequest('jobId is required.');
      const jobs = await readJSON('jobs/index.json', []);
      if (!jobs.some((j) => j.id === jobIdQ)) return notFound('Job not found.');
      const locations = await readJSON(`jobs/${jobIdQ}/locations.json`, []);
      return json(200, { locations });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const id = body.jobId || jobIdQ;
      const name = (body.name || '').trim();
      if (!id) return badRequest('jobId is required.');
      if (!name) return badRequest('A location name is required.');

      const jobs = await readJSON('jobs/index.json', []);
      if (!jobs.some((j) => j.id === id)) return notFound('Job not found.');

      const locations = await readJSON(`jobs/${id}/locations.json`, []);
      const location = { id: newId('loc'), name, createdAt: new Date().toISOString() };
      locations.push(location);
      await writeJSON(`jobs/${id}/locations.json`, locations);
      await writeJSON(`jobs/${id}/locations/${location.id}/photos.json`, []);
      return json(201, { location });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
