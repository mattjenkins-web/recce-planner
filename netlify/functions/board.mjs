// GET  /api/board?id=xxx                          -> { favs, hidden, comments } for one board
// POST /api/board {id, favs?, hidden?, comments?}  -> overwrite whichever fields are present
//
// A "board" is one shared map view (today, the single hardcoded demo map;
// once the map is wired up per real project/location, its id will be
// `${jobId}:${locationId}` instead). Ratings/comments/hidden-frame flags
// used to live only in each viewer's browser localStorage — that broke
// silently when the tool was viewed inside a cross-origin iframe (browsers
// restrict or wipe that kind of storage for embedded third-party content),
// and it meant nobody's star picks or comments were actually shared with
// the rest of the team. This makes that state real and shared.
//
// Each field is a small whole-object overwrite (favs/hidden are simple
// shotId->value maps; comments is shotId->array), mirroring exactly what
// used to be written to localStorage. Two people editing the *same* field
// at the exact same instant could still clobber each other (last write
// wins) — an acceptable tradeoff for a small team's casual use, and a real
// improvement over today's "doesn't persist at all" baseline.
import { json, badRequest, serverError, readJSON, writeJSON } from './lib/_lib.mjs';

export default async (req) => {
  try {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) return badRequest('id is required.');
      const [favs, hidden, comments] = await Promise.all([
        readJSON(`boards/${id}/favs.json`, {}),
        readJSON(`boards/${id}/hidden.json`, {}),
        readJSON(`boards/${id}/comments.json`, {}),
      ]);
      return json(200, { favs, hidden, comments });
    }

    if (req.method === 'POST') {
      const text = await req.text();
      const body = text ? JSON.parse(text) : {};
      const id = body.id || url.searchParams.get('id');
      if (!id) return badRequest('id is required.');

      const writes = [];
      if (body.favs !== undefined) writes.push(writeJSON(`boards/${id}/favs.json`, body.favs));
      if (body.hidden !== undefined) writes.push(writeJSON(`boards/${id}/hidden.json`, body.hidden));
      if (body.comments !== undefined) writes.push(writeJSON(`boards/${id}/comments.json`, body.comments));
      await Promise.all(writes);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
