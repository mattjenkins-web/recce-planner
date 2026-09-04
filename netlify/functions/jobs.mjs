// GET    /api/jobs                              -> list the signed-in user's jobs, each with counts + a cover photo
// POST   /api/jobs {name, shootDate?, ...meta}   -> create a job owned by the signed-in user
// PATCH  /api/jobs?id=xxx {...any field}         -> update one of the signed-in user's jobs (inline-edit from the job tile)
// DELETE /api/jobs?id=xxx                        -> remove one of the signed-in user's jobs
//
// Jobs/locations/photos metadata now live in Postgres (see supabase/schema.sql)
// instead of the old Netlify Blobs JSON index files — every table is scoped
// to its owner via row-level security, so this is naturally ready for
// "100s of users, 100s of jobs each" instead of one shared flat file per job.
import { json, badRequest, notFound, serverError, parseBody } from './lib/_lib.mjs';
import { clientForRequest, currentUser } from './lib/_supabase.mjs';

// The production-info fields are `text[]` columns (room to grow into real
// multi-value chips later — e.g. two producers on one job) but today's UI
// just edits one plain string per field, so a value in is wrapped as a
// single-element array and a value out is unwrapped back to a string.
const META_FIELDS = { agency: 'agency', productionCompany: 'production_company', director: 'director', dop: 'dop', producer: 'producer' };
const toArrayCol = (v) => (typeof v === 'string' && v.trim() ? [v.trim()] : []);
const fromArrayCol = (arr) => (Array.isArray(arr) && arr[0]) || '';

function toApiJob(j, extra) {
  const out = {
    id: j.id, name: j.name, shootDate: j.shoot_date, createdAt: j.created_at, folderId: j.folder_id || null,
  };
  for (const [apiKey, col] of Object.entries(META_FIELDS)) out[apiKey] = fromArrayCol(j[col]);
  return Object.assign(out, extra);
}

export default async (req) => {
  try {
    const { client, token } = clientForRequest(req);
    const user = await currentUser(client, token);
    if (!user) return json(401, { error: 'Sign in required.' });

    const url = new URL(req.url);
    const cols = `id, name, shoot_date, created_at, folder_id, ${Object.values(META_FIELDS).join(', ')}`;

    if (req.method === 'GET') {
      const { data: jobs, error } = await client.from('jobs').select(cols).order('created_at', { ascending: false });
      if (error) return serverError(error);

      // Counts and the cover photo aren't stored on the job row itself —
      // filled in here from the child tables, same spirit as the old
      // index-file enrichment, just against real tables instead of nested
      // JSON reads.
      const jobIds = jobs.map((j) => j.id);
      const locCountByJob = {};
      const photosByJob = {};
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
          const { data: photos, error: photoErr } = await client
            .from('photos').select('id, location_id, rating, sort_order, uploaded_at').in('location_id', locIds);
          if (photoErr) return serverError(photoErr);
          (photos || []).forEach((p) => {
            const jobId = locToJob[p.location_id];
            (photosByJob[jobId] = photosByJob[jobId] || []).push(p);
          });
        }
      }

      const enriched = jobs.map((j) => {
        const photos = photosByJob[j.id] || [];
        const byOrder = (a, b) => (a.sort_order - b.sort_order) || (new Date(a.uploaded_at) - new Date(b.uploaded_at));
        const sorted = photos.slice().sort(byOrder);
        // "First favourite, or the first frame if nothing's been favourited" —
        // a favourite is any photo with a star rating above zero.
        const cover = sorted.find((p) => p.rating > 0) || sorted[0] || null;
        return toApiJob(j, {
          locationCount: locCountByJob[j.id] || 0,
          photoCount: photos.length,
          coverUrl: cover ? `/api/photo?id=${cover.id}` : null,
        });
      });
      return json(200, { jobs: enriched });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      if (!name) return badRequest('A job name is required.');

      const insertRow = { name, shoot_date: body.shootDate || null, folder_id: body.folderId || null, owner_id: user.id };
      for (const [apiKey, col] of Object.entries(META_FIELDS)) insertRow[col] = toArrayCol(body[apiKey]);

      const { data: job, error } = await client.from('jobs').insert(insertRow).select(cols).single();
      if (error) return serverError(error);
      return json(201, { job: toApiJob(job, { locationCount: 0, photoCount: 0, coverUrl: null }) });
    }

    if (req.method === 'PATCH') {
      const body = await parseBody(req);
      const id = url.searchParams.get('id') || body.id;
      if (!id) return badRequest('id is required.');

      const patch = {};
      if (typeof body.name === 'string') {
        const name = body.name.trim();
        if (!name) return badRequest('Job name can’t be empty.');
        patch.name = name;
      }
      if ('shootDate' in body) patch.shoot_date = body.shootDate || null;
      if ('folderId' in body) patch.folder_id = body.folderId || null;
      for (const [apiKey, col] of Object.entries(META_FIELDS)) {
        if (apiKey in body) patch[col] = toArrayCol(body[apiKey]);
      }
      if (!Object.keys(patch).length) return badRequest('Nothing to update.');

      const { data: job, error } = await client.from('jobs').update(patch).eq('id', id).select(cols).single();
      // A row-count-zero update (job not owned by this user, or doesn't
      // exist) comes back as a "no rows" error from .single() — a 404 reads
      // better to the caller than the raw Postgres error.
      if (error) return notFound('Job not found.');
      return json(200, { job: toApiJob(job) });
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
