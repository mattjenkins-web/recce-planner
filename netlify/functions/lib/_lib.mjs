// Shared helpers used by all the Recce Planner API functions.
// V2 functions (the `export default async (req) => ...` form) get Netlify
// Blobs context injected automatically — no connectLambda bridge needed,
// and (unlike classic/V1 functions) they support strong consistency, which
// matters here: several endpoints do read-modify-write on the same JSON
// index file in quick succession (e.g. uploading several photos back to
// back), and eventual consistency could make one write silently clobber
// another with a stale read.
import { getStore } from '@netlify/blobs';

function store() {
  return getStore({ name: 'recce', consistency: 'strong' });
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const badRequest = (msg) => json(400, { error: msg });
const notFound = (msg) => json(404, { error: msg || 'Not found' });
const serverError = (err) => {
  console.error(err);
  return json(500, { error: 'Server error', detail: String((err && err.message) || err) });
};

function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

async function readJSON(key, fallback) {
  const val = await store().get(key, { type: 'json' });
  return val == null ? fallback : val;
}

async function writeJSON(key, value) {
  await store().setJSON(key, value);
}

async function parseBody(req) {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Request body must be valid JSON');
  }
}

export { store, json, badRequest, notFound, serverError, newId, readJSON, writeJSON, parseBody };
