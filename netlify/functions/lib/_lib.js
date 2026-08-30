// Shared helpers used by all the Recce Planner API functions.
const { getStore, connectLambda } = require('@netlify/blobs');

// One blob store holds everything: job/location indexes as small JSON
// documents, plus the raw photo bytes. Keys are namespaced by path so it
// reads like a filesystem even though it's flat key/value storage.
// (Strong consistency needs an 'uncachedEdgeURL' that isn't available via
// connectLambda's classic-function context, so we use the default —
// eventual consistency is fine for this app's read-modify-write volume.)
function store() {
  return getStore({ name: 'recce' });
}

const json = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
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
  const s = store();
  const val = await s.get(key, { type: 'json' });
  return val == null ? fallback : val;
}

async function writeJSON(key, value) {
  const s = store();
  await s.setJSON(key, value);
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Request body must be valid JSON');
  }
}

module.exports = { store, connectLambda, json, badRequest, notFound, serverError, newId, readJSON, writeJSON, parseBody };
