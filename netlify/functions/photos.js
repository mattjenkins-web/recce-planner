// GET  /api/photos?jobId=&locationId=                    -> list photo metadata for a location
// POST /api/photos {jobId, locationId, filename,
//                   contentType, dataBase64, bearing?,
//                   tilt?, lens?, notes?}                 -> upload a photo
//
// GPS lat/lon (and, on some phones, compass heading) are pulled from the
// photo's own EXIF data when present. Bearing/tilt/lens are frequently
// missing from EXIF entirely (most cameras never record them), so manual
// values passed in the request always win over anything auto-detected.
const exifr = require('exifr');
const { store, connectLambda, json, badRequest, notFound, serverError, newId, readJSON, writeJSON, parseBody } = require('./lib/_lib');

const MAX_BYTES = 8 * 1024 * 1024; // 8MB raw image ceiling (well under the ~6MB base64 request limit once accounted for, see README note)

async function extractExif(buffer) {
  const out = { hasGps: false, lat: null, lon: null, gpsBearing: null, capturedAt: null, cameraMake: null, cameraModel: null, lensModel: null };
  try {
    const tags = await exifr.parse(buffer, {
      gps: true, exif: true, tiff: true, translateValues: true,
      pick: ['Make', 'Model', 'LensModel', 'DateTimeOriginal', 'GPSImgDirection'],
    });
    if (tags) {
      out.cameraMake = tags.Make || null;
      out.cameraModel = tags.Model || null;
      out.lensModel = tags.LensModel || null;
      out.capturedAt = tags.DateTimeOriginal ? new Date(tags.DateTimeOriginal).toISOString() : null;
      if (typeof tags.GPSImgDirection === 'number') out.gpsBearing = Math.round(tags.GPSImgDirection);
    }
    const gps = await exifr.gps(buffer).catch(() => null);
    if (gps && typeof gps.latitude === 'number') {
      out.hasGps = true;
      out.lat = gps.latitude;
      out.lon = gps.longitude;
    }
  } catch (e) {
    // Not every image has EXIF (e.g. screenshots, re-saved/edited files) —
    // that's fine, the upload still proceeds with manual fields only.
    console.warn('EXIF read failed, continuing without it:', e.message);
  }
  return out;
}

exports.handler = async (event) => {
  connectLambda(event);
  try {
    const q = event.queryStringParameters || {};

    if (event.httpMethod === 'GET') {
      const { jobId, locationId } = q;
      if (!jobId || !locationId) return badRequest('jobId and locationId are required.');
      const photos = await readJSON(`jobs/${jobId}/locations/${locationId}/photos.json`, []);
      return json(200, { photos: photos.map((p) => ({ ...p, url: `/api/photo?id=${p.id}` })) });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      const { jobId, locationId, filename, contentType, dataBase64 } = body;
      if (!jobId || !locationId) return badRequest('jobId and locationId are required.');
      if (!dataBase64) return badRequest('dataBase64 (the photo, base64-encoded) is required.');

      const jobs = await readJSON('jobs/index.json', []);
      if (!jobs.some((j) => j.id === jobId)) return notFound('Job not found.');
      const locations = await readJSON(`jobs/${jobId}/locations.json`, []);
      if (!locations.some((l) => l.id === locationId)) return notFound('Location not found.');

      const buffer = Buffer.from(dataBase64, 'base64');
      if (buffer.length > MAX_BYTES) {
        return json(413, { error: `Photo is too large (${(buffer.length / 1e6).toFixed(1)}MB). Please keep uploads under 8MB.` });
      }

      const exif = await extractExif(buffer);
      const id = newId('photo');
      const type = contentType || 'image/jpeg';

      await store().set(`photos/${id}`, buffer, {
        metadata: { contentType: type, jobId, locationId, filename: filename || `${id}.jpg` },
      });

      const record = {
        id,
        jobId,
        locationId,
        filename: filename || `${id}.jpg`,
        contentType: type,
        uploadedAt: new Date().toISOString(),
        hasGps: exif.hasGps,
        lat: exif.hasGps ? exif.lat : null,
        lon: exif.hasGps ? exif.lon : null,
        capturedAt: exif.capturedAt,
        cameraMake: exif.cameraMake,
        cameraModel: exif.cameraModel,
        // Manual fields always win; fall back to EXIF's compass heading if the
        // photographer didn't supply one and the phone happened to record it.
        bearing: body.bearing != null && body.bearing !== '' ? Number(body.bearing) : exif.gpsBearing,
        tilt: body.tilt != null && body.tilt !== '' ? Number(body.tilt) : null,
        lens: body.lens || exif.lensModel || null,
        notes: body.notes || '',
      };

      const photosKey = `jobs/${jobId}/locations/${locationId}/photos.json`;
      const photos = await readJSON(photosKey, []);
      photos.push(record);
      await writeJSON(photosKey, photos);

      return json(201, { photo: { ...record, url: `/api/photo?id=${id}` } });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
