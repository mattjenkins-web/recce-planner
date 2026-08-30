// GET  /api/jobs           -> list jobs
// POST /api/jobs {name}    -> create a job, returns the new job record
const { json, badRequest, serverError, newId, readJSON, writeJSON, parseBody } = require('./lib/_lib');

const INDEX_KEY = 'jobs/index.json';

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const jobs = await readJSON(INDEX_KEY, []);
      return json(200, { jobs });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
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
