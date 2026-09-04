// GET    /api/folders           -> list the signed-in user's folders
// POST   /api/folders {name}    -> create a folder
// DELETE /api/folders?id=xxx    -> remove a folder (jobs inside it fall back to "no folder", not deleted)
import { json, badRequest, notFound, serverError, parseBody } from './lib/_lib.mjs';
import { clientForRequest, currentUser } from './lib/_supabase.mjs';

export default async (req) => {
  try {
    const { client, token } = clientForRequest(req);
    const user = await currentUser(client, token);
    if (!user) return json(401, { error: 'Sign in required.' });

    const url = new URL(req.url);

    if (req.method === 'GET') {
      const { data: folders, error } = await client.from('folders').select('id, name, created_at').order('name');
      if (error) return serverError(error);
      return json(200, { folders: folders.map((f) => ({ id: f.id, name: f.name, createdAt: f.created_at })) });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const name = (body.name || '').trim();
      if (!name) return badRequest('A folder name is required.');
      const { data: folder, error } = await client
        .from('folders').insert({ name, owner_id: user.id }).select('id, name, created_at').single();
      if (error) return serverError(error);
      return json(201, { folder: { id: folder.id, name: folder.name, createdAt: folder.created_at } });
    }

    if (req.method === 'DELETE') {
      const body = await parseBody(req).catch(() => ({}));
      const id = url.searchParams.get('id') || body.id;
      if (!id) return badRequest('id is required.');
      // Jobs inside this folder aren't deleted — `jobs.folder_id` has
      // `on delete set null`, so they just become uncategorized again.
      const { data, error } = await client.from('folders').delete().eq('id', id).select('id');
      if (error) return serverError(error);
      if (!data || !data.length) return notFound('Folder not found.');
      return json(200, { deleted: id });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
