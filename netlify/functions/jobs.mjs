// GET    /api/jobs                    -> list the signed-in user's jobs, each with location/photo counts
// POST   /api/jobs {name, shootDate?} -> create a job owned by the signed-in user
// DELETE /api/jobs?id=xxx             -> remove one of the signed-in user's jobs
//
// Jobs/locations/photos metadata now live in Postgres (see supabase/schema.sql)
// instead of the old Netlify Blobs JSON index files — every table is scoped
// to its owner via row-level security, so this is naturally ready for
// "100s of users, 100s of jobs each" instead of one shared flat file per job.
import { json, badRequest, notFound, serverError, parseBody } from './lib/_lib.mjs';
import { clientForRequest, currentUser } from './lib/_supabase.mjs';

export default async (req) => {
  try {
    const { client, token } = clientForRequest(req);
    const user = await currentUser(client, token);
    if (!user) return json(401, { error: 'Sign in required.' });

    const url = new URL(req.url);

    if (req.method === 'GET') {
      const { data: jobs, error } = await client
        .from('jobs')
        .select('id, name, shoot_date, created_at')
        .order('created_at', { ascending: false });
      if (error) return serverError(error);

      // Counts aren't stored on the job row itself — filled in here from the
      // child tables, same spirit as the old index-file enrichment, just
      // against real tables instead of nested JSON reads.
      const jobIds = jobs.map((j) => j.id);
      const locCountByJob = {};
      const photoCountByJob = {};
      if (jobIds.length) {
        const { data: locs, error: locErr } = await client.from('locations').select('id, job_id').in('job_id', jobIds);
        if (locErr) return serverError(locErr);
        const locToJob = {};
        (locs || []).forEach((l) => {
          locCountByJob[l.job_id] = (locCountByJob[l.job_id] || 0) + 1;
          locToJob[l.id] = l.job_id;
        });
        const locIds = (locs || []).map((l) => l.id);
        if (locIds.length) {
          const { data: photos, error: photoErr } = await client.from('photos').select('id, location_id').in('location_id', locIds);
          if (photoErr) return serverError(photoErr);
          (photos || []).forEach((p) => {
            const jobId = locToJob[p.location_id];
            photoCountByJob[jobId] = (photoCountByJob[jobId] || 0) + 1;
          });
        }
      }

      const enriched = jobs.map((j) => ({
        id: j.id,
        name: j.name,
        shootDate: j.shoot_date,
        createdAt: j.created_at,
        locationCount: locCountByJob[j.id] || 0,
        photoCount: photoCountByJob[j.id] || 0,
      }));
      return json(200, { jobs: enriched });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      if (!name) return badRequest('A job name is required.');

      const { data: job, error } = await client
        .from('jobs')
        .insert({ name, shoot_date: body.shootDate || null, owner_id: user.id })
        .select('id, name, shoot_date, created_at')
        .single();
      if (error) return serverError(error);
      return json(201, { job: { id: job.id, name: job.name, shootDate: job.shoot_date, createdAt: job.created_at } });
    }

    if (req.method === 'DELETE') {
      const body = await parseBody(req).catch(() => ({}));
      const id = url.searchParams.get('id') || body.id;
      if (!id) return badRequest('id is required.');
      const { data, error } = await client.from('jobs').delete().eq('id', id).select('id');
      if (error) return serverError(error);
      if (!data || !data.length) return notFound('Job not found.');
      // Deleting the job row cascades to its locations/photos rows (see the
      // `on delete cascade` foreign keys in schema.sql) — only the photo
      // *bytes* in Blobs are left behind, same harmless-orphan tradeoff as
      // before, since sweeping those up costs a lot more round trips than
      // it's worth for a "delete my test job" action.
      return json(200, { deleted: id });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
