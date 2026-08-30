// GET /api/photo?id=xxx -> streams the raw image bytes back out
const { store, connectLambda, badRequest, notFound, serverError } = require('./lib/_lib');

exports.handler = async (event) => {
  connectLambda(event);
  try {
    if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
    const id = event.queryStringParameters && event.queryStringParameters.id;
    if (!id) return badRequest('id is required.');

    const result = await store().getWithMetadata(`photos/${id}`, { type: 'arrayBuffer' });
    if (!result) return notFound('Photo not found.');

    const contentType = (result.metadata && result.metadata.contentType) || 'application/octet-stream';
    return {
      statusCode: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=31536000, immutable',
      },
      body: Buffer.from(result.data).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return serverError(err);
  }
};
