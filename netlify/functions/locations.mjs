// GET  /api/locations?jobId=xxx     -> list locations for one of the signed-in user's jobs
// POST /api/locations {jobId, name} -> add a location to one of their jobs
import { json, badRequest, notFound, serverError, parseBody } from './lib/_lib.mjs';
import { clientForRequest, currentUser } from './lib/_supabase.mjs';

export default async (req) => {
  try {
    const { client, token } = clientForRequest(req);
    const user = await currentUser(client, token);
    if (!user) return json(401, { error: 'Sign in required.' });

    const url = new URL(req.url);
    const jobIdQ = url.searchParams.get('jobId');

    if (req.method === 'GET') {
      if (!jobIdQ) return badRequest('jobId is required.');
      const { data: locations, error } = await client
        .from('locations')
        .select('id, name, created_at')
        .eq('job_id', jobIdQ)
        .order('created_at');
      if (error) return serverError(error);
      return json(200, { locations: locations.map((l) => ({ id: l.id, name: l.name, createdAt: l.created_at })) });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const id = body.jobId || jobIdQ;
      const name = (body.name || '').trim();
      if (!id) return badRequest('jobId is required.');
      if (!name) return badRequest('A location name is required.');

      const { data: location, error } = await client
        .from('locations')
        .insert({ job_id: id, name })
        .select('id, name, created_at')
        .single();
      // Row-level security silently rejects an insert against a job you
      // don't own (the policy's WITH CHECK fails) — that surfaces here as a
      // generic Postgres error rather than one naming the job, so a 404
      // ("Job not found") reads better to the caller than the raw DB error.
      if (error) return notFound('Job not found.');
      return json(201, { location: { id: location.id, name: location.name, createdAt: location.created_at } });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
