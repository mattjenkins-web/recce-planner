// EXIF (GPS / bearing / time / lens) + NOAA solar position. No dependencies.

const RAD = Math.PI / 180;

/* ---------------- EXIF ---------------- */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readVal(v, off, type, count, le) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = off + i * TYPE_SIZE[type];
    switch (type) {
      case 1: case 7: out.push(v.getUint8(o)); break;
      case 2: out.push(String.fromCharCode(v.getUint8(o))); break;
      case 3: out.push(v.getUint16(o, le)); break;
      case 4: out.push(v.getUint32(o, le)); break;
      case 9: out.push(v.getInt32(o, le)); break;
      case 5: out.push(v.getUint32(o, le) / (v.getUint32(o + 4, le) || 1)); break;
      case 10: out.push(v.getInt32(o, le) / (v.getInt32(o + 4, le) || 1)); break;
      default: out.push(null);
    }
  }
  if (type === 2) return out.join('').replace(/\0+$/, '');
  return count === 1 ? out[0] : out;
}

function readIFD(v, tiff, ifd, le, want) {
  const tags = {};
  const n = v.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = v.getUint16(e, le);
    if (want && !want.has(tag)) continue;
    const type = v.getUint16(e + 2, le);
    const count = v.getUint32(e + 4, le);
    if (!TYPE_SIZE[type]) continue;
    const bytes = TYPE_SIZE[type] * count;
    const off = bytes > 4 ? tiff + v.getUint32(e + 8, le) : e + 8;
    if (off + bytes > v.byteLength) continue;
    tags[tag] = readVal(v, off, type, count, le);
  }
  return tags;
}

const IFD0 = new Set([0x010f, 0x0110, 0x0112, 0x8769, 0x8825]);
const EXIF_IFD = new Set([0x829a, 0x829d, 0x8827, 0x9003, 0x9004, 0x9011, 0x920a, 0xa002, 0xa003, 0xa405]);

function dms(a, ref) {
  if (a == null) return null;
  const [d, m = 0, s = 0] = Array.isArray(a) ? a : [a];
  const dec = d + m / 60 + s / 3600;
  return (ref === 'S' || ref === 'W') ? -dec : dec;
}

function exifDate(str, offset) {
  if (!str) return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(str);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S] = m.map(Number);
  const tz = offset && /^([+-])(\d{2}):(\d{2})/.exec(offset);
  if (tz) {
    const sign = tz[1] === '-' ? -1 : 1;
    const mins = sign * (Number(tz[2]) * 60 + Number(tz[3]));
    return new Date(Date.UTC(Y, Mo - 1, D, H, Mi, S) - mins * 60000);
  }
  return new Date(Y, Mo - 1, D, H, Mi, S); // local time of the reader
}

/** Parse a JPEG File/Blob. Returns null when there is no usable EXIF. */
export async function readExif(file) {
  const buf = await file.arrayBuffer();
  const v = new DataView(buf);
  if (v.getUint16(0) !== 0xffd8) return null;
  let p = 2, tiff = -1;
  while (p < v.byteLength - 4) {
    if (v.getUint8(p) !== 0xff) break;
    const marker = v.getUint8(p + 1);
    const len = v.getUint16(p + 2);
    if (marker === 0xe1) {
      let s = '';
      for (let i = 0; i < 4; i++) s += String.fromCharCode(v.getUint8(p + 4 + i));
      if (s === 'Exif') { tiff = p + 10; break; }
    }
    if (marker === 0xda) break;
    p += 2 + len;
  }
  if (tiff < 0) return null;
  const le = v.getUint16(tiff) === 0x4949;
  const ifd0 = readIFD(v, tiff, tiff + v.getUint32(tiff + 4, le), le, IFD0);
  const ex = ifd0[0x8769] ? readIFD(v, tiff, tiff + ifd0[0x8769], le, EXIF_IFD) : {};
  const off = ifd0[0x8769] ? readIFD(v, tiff, tiff + ifd0[0x8769], le, new Set([0x9011])) : {};
  const gps = ifd0[0x8825] ? readIFD(v, tiff, tiff + ifd0[0x8825], le) : {};

  const lat = dms(gps[2], gps[1]);
  const lon = dms(gps[4], gps[3]);
  let alt = gps[6] != null ? (Array.isArray(gps[6]) ? gps[6][0] : gps[6]) : null;
  if (alt != null && gps[5] === 1) alt = -alt;

  const bearing = gps[17] != null ? (Array.isArray(gps[17]) ? gps[17][0] : gps[17])
    : (gps[24] != null ? (Array.isArray(gps[24]) ? gps[24][0] : gps[24]) : null);

  const w = ex[0xa002] || null, h = ex[0xa003] || null;
  const f35 = ex[0xa405] || null;
  const focal = ex[0x920a] != null ? (Array.isArray(ex[0x920a]) ? ex[0x920a][0] : ex[0x920a]) : null;

  return {
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    alt,
    bearing: Number.isFinite(bearing) ? ((bearing % 360) + 360) % 360 : null,
    bearingRef: gps[16] === 'M' ? 'magnetic' : gps[16] === 'T' ? 'true' : null,
    when: exifDate(ex[0x9003] || ex[0x9004], off[0x9011]),
    camera: [ifd0[0x010f], ifd0[0x0110]].filter(Boolean).join(' ').trim() || null,
    orientation: ifd0[0x0112] || 1,
    pixelW: w, pixelH: h,
    focal, focal35: f35,
    fov: fovFrom(f35, w, h),
  };
}

/** Horizontal + vertical field of view in degrees from 35mm-equivalent focal length. */
export function fovFrom(f35, w, h) {
  const f = f35 || 28; // sensible phone-ish default
  const hfov = 2 * Math.atan(36 / (2 * f)) / RAD;
  const ar = w && h ? Math.max(w, h) / Math.min(w, h) : 4 / 3;
  const vfov = hfov / ar;
  return { hfov, vfov, assumed: !f35 };
}

/* ---------------- Sun ---------------- */

function solarBase(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan(eps / 2 * RAD) ** 2;
  const eqTime = 4 * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD)) / RAD;
  return { decl, eqTime };
}

/** Sun azimuth (deg from true north) and elevation (deg) for a moment and place. */
export function sunPos(date, lat, lon) {
  const { decl, eqTime } = solarBase(date);
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = ((utcMin + eqTime + 4 * lon) % 1440 + 1440) % 1440;
  const ha = tst / 4 - 180;
  const cosZ = Math.sin(lat * RAD) * Math.sin(decl * RAD)
    + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  const z = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  let az = 0;
  const sinZ = Math.sin(z);
  if (Math.abs(sinZ) > 1e-6) {
    const c = (Math.sin(lat * RAD) * Math.cos(z) - Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * sinZ);
    az = Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
    az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  }
  const el = 90 - z / RAD;
  return { azimuth: az, elevation: el, declination: decl };
}

function utcMinutesForZenith(date, lat, lon, zenith, rising) {
  const { decl, eqTime } = solarBase(date);
  const cosH = Math.cos(zenith * RAD) / (Math.cos(lat * RAD) * Math.cos(decl * RAD))
    - Math.tan(lat * RAD) * Math.tan(decl * RAD);
  if (cosH > 1 || cosH < -1) return null;
  const H = Math.acos(cosH) / RAD;
  return 720 - 4 * (lon + (rising ? H : -H)) - eqTime;
}

function atUtcMinutes(day, mins) {
  if (mins == null) return null;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0) + mins * 60000);
}

/** Sunrise/sunset/golden-hour edges and solar noon for the UTC day of `date`. */
export function sunEvents(date, lat, lon) {
  const noonMin = utcMinutesForZenith(date, lat, lon, 90.833, true) != null
    ? 720 - 4 * lon - solarBase(date).eqTime : null;
  return {
    sunrise: atUtcMinutes(date, utcMinutesForZenith(date, lat, lon, 90.833, true)),
    sunset: atUtcMinutes(date, utcMinutesForZenith(date, lat, lon, 90.833, false)),
    goldenMorningEnd: atUtcMinutes(date, utcMinutesForZenith(date, lat, lon, 84, true)),
    goldenEveningStart: atUtcMinutes(date, utcMinutesForZenith(date, lat, lon, 84, false)),
    noon: atUtcMinutes(date, noonMin),
  };
}

/** Sun track for the whole day: samples every `stepMin` minutes while above the horizon. */
export function sunTrack(date, lat, lon, stepMin = 10) {
  const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const out = [];
  for (let m = 0; m <= 1440; m += stepMin) {
    const d = new Date(base + m * 60000);
    const p = sunPos(d, lat, lon);
    if (p.elevation > -1) out.push({ ...p, when: d });
  }
  return out;
}

/* ---------------- geo helpers ---------------- */

/** Move from lat/lon along a bearing for `metres`. */
export function destination(lat, lon, bearing, metres) {
  const R = 6371008.8;
  const d = metres / R, b = bearing * RAD, f1 = lat * RAD, l1 = lon * RAD;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [f2 / RAD, ((l2 / RAD + 540) % 360) - 180];
}

/** Signed smallest angle from a to b, in degrees (-180..180). */
export function angleDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
