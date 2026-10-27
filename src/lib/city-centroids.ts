// Lake County community centroids [lat, lon]. A listing belongs to the nearest
// centroid, and anything farther than MAX_CITY_DISTANCE_KM from all of them is
// outside the directory. Shared by the OSM import and the Google Places import.
export const CENTROIDS: Record<string, [number, number]> = {
  astatula: [28.7097, -81.7329], clermont: [28.5494, -81.7729], eustis: [28.8528, -81.6854], "fruitland-park": [28.8583, -81.9070], groveland: [28.5581, -81.8512], "howey-in-the-hills": [28.7169, -81.7717], "lady-lake": [28.9172, -81.9229], leesburg: [28.8108, -81.8779], mascotte: [28.5786, -81.8867], minneola: [28.5742, -81.7462], montverde: [28.6, -81.6742], "mount-dora": [28.8025, -81.6445], paisley: [28.9836, -81.5387], sorrento: [28.8081, -81.5631], tavares: [28.8042, -81.7256], "the-villages": [28.9594, -81.9492], umatilla: [28.9294, -81.6656],
};
export const MAX_CITY_DISTANCE_KM = 12;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestCityFor(lat: number, lon: number): { slug: string; distance: number } | null {
  let closest: { slug: string; distance: number } | null = null;
  for (const [slug, [cLat, cLon]] of Object.entries(CENTROIDS)) {
    const distance = haversineKm(lat, lon, cLat, cLon);
    if (!closest || distance < closest.distance) closest = { slug, distance };
  }
  return closest;
}
