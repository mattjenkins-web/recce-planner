// GET  /api/photos?locationId=xxx                          -> list photo metadata for a location
// POST /api/photos {locationId, filename, contentType,
//                   dataBase64, lat?, lon?, bearing?, tilt?,
//                   lens?, notes?, capturedAt?, cameraMake?,
//                   cameraModel?, shotType?}                 -> upload a photo
//
// Metadata (everything except the raw image bytes) now lives in the `photos`
// Postgres table instead of a per-location JSON file — row-level security
// (chained location -> job -> owner, see supabase/schema.sql) scopes every
// read/write to the signed-in user automatically. The image bytes themselves
// still live in Netlify Blobs (unchanged — that was never the bottleneck),
// keyed by the row's own id so `photo.mjs` can look one up from the other.
//
// GPS lat/lon (and, on some phones, compass heading) are pulled from the
// photo's own EXIF data when present. Bearing/tilt/lens are frequently
// missing from EXIF entirely (most cameras never record them), so manual
// values passed in the request always win over anything auto-detected here.
// The upload UI also reads EXIF client-side (before it may downscale a large
// photo for upload, which strips EXIF) and sends lat/lon/capturedAt/camera
// fields explicitly for exactly that reason — those take priority too.
import { randomUUID } from 'node:crypto';
import exifr from 'exifr';
import { store, json, badRequest, notFound, serverError, parseBody } from './lib/_lib.mjs';
import { clientForRequest, currentUser } from './lib/_supabase.mjs';

// Netlify's classic functions cap the request body around 6MB; base64
// inflates raw bytes by ~37%, so this stays safely under that regardless of
// JSON overhead. The upload UI downscales anything larger before sending.
const MAX_BYTES = 4.5 * 1024 * 1024;

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

function toApiPhoto(p) {
  return {
    id: p.id,
    locationId: p.location_id,
    filename: p.filename,
    contentType: p.content_type,
    shotType: p.shot_type,
    uploadedAt: p.uploaded_at,
    hasGps: p.has_gps,
    lat: p.lat,
    lon: p.lon,
    capturedAt: p.captured_at,
    cameraMake: p.camera_make,
    cameraModel: p.camera_model,
    bearing: p.bearing,
    tilt: p.tilt,
    lens: p.lens,
    notes: p.notes,
    rating: p.rating,
    hidden: p.hidden,
    url: `/api/photo?id=${p.id}`,
  };
}

export default async (req) => {
  try {
    const { client, token } = clientForRequest(req);
    const user = await currentUser(client, token);
    if (!user) return json(401, { error: 'Sign in required.' });

    const url = new URL(req.url);

    if (req.method === 'GET') {
      const locationId = url.searchParams.get('locationId');
      if (!locationId) return badRequest('locationId is required.');
      const { data: photos, error } = await client
        .from('photos')
        .select('*')
        .eq('location_id', locationId)
        .order('sort_order')
        .order('uploaded_at');
      if (error) return serverError(error);
      return json(200, { photos: photos.map(toApiPhoto) });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const { locationId, filename, contentType, dataBase64 } = body;
      if (!locationId) return badRequest('locationId is required.');
      if (!dataBase64) return badRequest('dataBase64 (the photo, base64-encoded) is required.');

      const buffer = Buffer.from(dataBase64, 'base64');
      if (buffer.length > MAX_BYTES) {
        return json(413, { error: `Photo is too large (${(buffer.length / 1e6).toFixed(1)}MB). Please keep uploads under ${(MAX_BYTES / 1e6).toFixed(1)}MB.` });
      }

      const exif = await extractExif(buffer);
      const id = randomUUID();
      const type = contentType || 'image/jpeg';
      const blobKey = `photos/${id}`;

      // Client-supplied GPS wins over server-side EXIF: the upload UI reads
      // EXIF from the original file before it potentially downscales the
      // image (which strips all EXIF) for the trip over the wire.
      const hasClientGps = typeof body.lat === 'number' && typeof body.lon === 'number';
      const hasGps = hasClientGps || exif.hasGps;
      const row = {
        id,
        location_id: locationId,
        blob_key: blobKey,
        filename: filename || `${id}.jpg`,
        content_type: type,
        shot_type: body.shotType || null,
        lat: hasClientGps ? body.lat : (exif.hasGps ? exif.lat : null),
        lon: hasClientGps ? body.lon : (exif.hasGps ? exif.lon : null),
        has_gps: hasGps,
        // Manual fields always win; fall back to EXIF's compass heading if
        // the photographer didn't supply one and the phone happened to
        // record it.
        bearing: body.bearing != null && body.bearing !== '' ? Number(body.bearing) : exif.gpsBearing,
        tilt: body.tilt != null && body.tilt !== '' ? Number(body.tilt) : null,
        lens: body.lens || exif.lensModel || null,
        camera_make: body.cameraMake || exif.cameraMake,
        camera_model: body.cameraModel || exif.cameraModel,
        captured_at: body.capturedAt || exif.capturedAt,
        notes: body.notes || '',
      };

      // Insert the metadata row first — row-level security rejects it if
      // this location isn't one of the signed-in user's, and there's no
      // point writing the (much larger) image bytes to Blobs if that fails.
      const { data: photo, error } = await client.from('photos').insert(row).select('*').single();
      if (error) return notFound('Location not found.');

      await store().set(blobKey, buffer, { metadata: { contentType: type } });

      return json(201, { photo: toApiPhoto(photo) });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return serverError(err);
  }
};
