// GET /api/cover?id=xxx -> streams a job's manually-set hero/cover photo, if one exists
//
// Deliberately doesn't require a signed-in session, same reasoning as
// photo.mjs: this is used in a plain <img src="..."> tag, which can't carry
// an Authorization header, and the id is an unguessable UUID the caller
// already has to know. The blob key is just `covers/${jobId}` — no DB
// column needed to track "does this job have a custom cover", since the
// key is fully deterministic from the job id.
import { store, badRequest, notFound, serverError } from './lib/_lib.mjs';

export default async (req) => {
  try {
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return badRequest('id is required.');

    const result = await store().getWithMetadata(`covers/${id}`, { type: 'arrayBuffer' });
    if (!result) return notFound('No custom cover set for this job.');

    return new Response(result.data, {
      status: 200,
      headers: {
        'content-type': (result.metadata && result.metadata.contentType) || 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    return serverError(err);
  }
};
