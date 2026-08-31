// GET /api/photo?id=xxx -> streams the raw image bytes back out
//
// Deliberately doesn't require a signed-in session: this URL is used in
// plain <img src="..."> tags, which can't attach an Authorization header.
// It only does a single exact-id lookup the caller already has to know (a
// random UUID) — the same "if you have the link" model the old Blobs-only
// version used. Nothing here lets you list or browse anyone else's photos.
import { store, badRequest, notFound, serverError } from './lib/_lib.mjs';
import { adminClient } from './lib/_supabase.mjs';

export default async (req) => {
  try {
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return badRequest('id is required.');

    const { data: photo, error } = await adminClient()
      .from('photos')
      .select('blob_key, content_type')
      .eq('id', id)
      .single();
    if (error || !photo) return notFound('Photo not found.');

    const bytes = await store().get(photo.blob_key, { type: 'arrayBuffer' });
    if (!bytes) return notFound('Photo not found.');

    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': photo.content_type || 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    return serverError(err);
  }
};
