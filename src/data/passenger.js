import region from '../../config/regions/perm.js';
import { validateCatalog } from './loader.js';

async function fetchData(file) {
  const response = await fetch(new URL(file, region.dataBaseUrl));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function loadPassengerNetwork() {
  return fetchData('trip-network.json');
}

export async function loadPassengerCatalog() {
  return validateCatalog(await fetchData('passenger-catalog.json'));
}

const shapes = new Map();

export function loadPassengerShape(id) {
  if (!shapes.has(id)) {
    shapes.set(id, fetchData(`trip-shapes/${encodeURIComponent(id)}.json`).catch(() => {
      shapes.delete(id);
      return [];
    }));
  }
  return shapes.get(id);
}
