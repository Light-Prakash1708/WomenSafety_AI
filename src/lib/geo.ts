// Geohash for area-level community reports. Precision 6 is about 1.2 km x 0.6 km,
// coarse enough that a report never pins down one woman's doorstep.
const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohash(lat: number, lng: number, precision = 6): string {
  let latR = [-90, 90];
  let lngR = [-180, 180];
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const r = even ? lngR : latR;
    const v = even ? lng : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) {
      ch |= 1 << (4 - bit);
      r[0] = mid;
    } else {
      r[1] = mid;
    }
    even = !even;
    if (++bit === 5) {
      hash += B32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** The cell plus its 8 neighbours, found by sampling around the point. */
export function nearbyCells(lat: number, lng: number): string[] {
  const dLat = 0.0055;
  const dLng = 0.011;
  const set = new Set<string>();
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) set.add(geohash(lat + a * dLat, lng + b * dLng));
  return [...set];
}

export const mapsLink = (lat: number, lng: number) =>
  `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}`;
