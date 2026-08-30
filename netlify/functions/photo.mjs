// GET /api/photo?id=xxx -> streams the raw image bytes back out
import { store, badRequest, notFound, serverError } from './lib/_lib.mjs';

export default async (req) => {
  try {
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return badRequest('id is required.');

    const result = await store().getWithMetadata(`photos/${id}`, { type: 'arrayBuffer' });
    if (!result) return notFound('Photo not found.');

    const contentType = (result.metadata && result.metadata.contentType) || 'application/octet-stream';
    return new Response(result.data, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    return serverError(err);
  }
};
