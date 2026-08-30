// GET  /api/locations?jobId=xxx          -> list locations for a job
// POST /api/locations {jobId, name}      -> add a location to a job
const { json, badRequest, notFound, serverError, newId, readJSON, writeJSON, parseBody } = require('./lib/_lib');

exports.handler = async (event) => {
  try {
    const jobId = event.queryStringParameters && event.queryStringParameters.jobId;

    if (event.httpMethod === 'GET') {
      if (!jobId) return badRequest('jobId is required.');
      const jobs = await readJSON('jobs/index.json', []);
      if (!jobs.some((j) => j.id === jobId)) return notFound('Job not found.');
      const locations = await readJSON(`jobs/${jobId}/locations.json`, []);
      return json(200, { locations });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      const id = body.jobId || jobId;
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
