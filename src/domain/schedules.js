import { normalizeText } from './transport.js';

const sheetDirectionOrder = new Map([
  ['registry-41п', ['outbound', 'inbound']],
  ['registry-11п', ['outbound', 'inbound']],
  ['registry-26п', ['outbound', 'inbound']],
  ['registry-12п', ['outbound', 'inbound']],
  ['registry-51п', ['outbound', 'inbound']],
  ['registry-55п', ['outbound', 'inbound']],
  ['registry-94п', ['inbound', 'outbound']],
  ['registry-14', ['outbound', 'inbound']],
  ['registry-53п', ['outbound', 'inbound']],
  ['registry-22п', ['inbound', 'outbound']],
  ['registry-97п', ['outbound', 'inbound']],
]);

const departuresFromVelta = new Set(['148!C7', '148!E7', '148!E8']);

export function departureOrigins(schedule, directionId) {
  const origins = new Map();
  for (const calendar of schedule?.calendars || []) {
    for (const direction of calendar.directions || []) {
      if (direction.directionId !== directionId) continue;
      for (const departure of direction.departures || []) {
        const alternative = departuresFromVelta.has(departure.sourceCell) && departure.note === 'с ОП Велта';
        const label = alternative ? 'ОП Велта' : direction.label;
        if (!label) continue;
        const key = normalizeText(label);
        if (!origins.has(key)) origins.set(key, { label, calendars: new Map(), alternative });
        const groups = origins.get(key).calendars;
        if (!groups.has(calendar.label)) groups.set(calendar.label, []);
        groups.get(calendar.label).push(departure);
      }
    }
  }
  return [...origins.values()].sort((a, b) => Number(a.alternative) - Number(b.alternative));
}

function registryDirections(route, byDirection) {
  const texts = (route.directions || []).map(direction => {
    const endpoints = direction.id === 'inbound' ? [route.to, route.from] : [route.from, route.to];
    const label = ['outbound', 'inbound'].includes(direction.id)
      ? endpoints.filter(Boolean).join(' → ') : direction.label;
    return { ...direction, label, sheetDirectionId: direction.id, registry: true };
  });
  const ids = route.mapRouteIds || [];
  const order = ids.length === 2 && ids[0].endsWith('-outbound') && ids[1].endsWith('-inbound')
    ? sheetDirectionOrder.get(route.id) : undefined;
  const mapped = ids.flatMap((id, index) => {
    const direction = byDirection.get(id);
    const sheetDirectionId = order?.[index];
    const sheet = texts.find(item => item.id === sheetDirectionId);
    return direction ? [{
      ...direction, label: sheet?.label || `${direction.from} → ${direction.to}`,
      shapeId: id, sheetDirectionId, registryStopIds: sheet?.stopIds ?? route.stopIds,
    }] : [];
  });
  if (!mapped.length) return texts;

  const mappedSheets = new Set(mapped.map(direction => direction.sheetDirectionId));
  return [...mapped, ...texts.filter(direction => !mappedSheets.has(direction.id)
    && departureOrigins(route.schedule, direction.id).length)];
}

export function buildScheduleCatalog(catalog, network) {
  const stops = new Map([...catalog.stops, ...network.stops].map(stop => [stop.id, stop]));
  const byDirection = new Map(network.directions.map(direction => [direction.id, direction]));
  const routes = catalog.routes.map(route => ({
    ...route, directions: registryDirections(route, byDirection),
  }));
  const city = new Map();
  for (const direction of network.directions.filter(direction => direction.city)) {
    const id = direction.id.replace(/-(?:fwd|bkwd)$/u, '');
    if (!city.has(id)) {
      city.set(id, {
        id, ref: direction.ref, name: `${direction.from} – ${direction.to}`, city: true, directions: [],
      });
    }
    city.get(id).directions.push({
      ...direction, label: `${direction.from} → ${direction.to}`, shapeId: direction.id,
    });
  }
  routes.push(...city.values());
  for (const route of routes) {
    const ids = new Set([...(route.stopIds || []), ...route.directions.flatMap(direction => direction.stopIds)]);
    route.searchTerms = [...ids].map(id => stops.get(id)?.name).filter(Boolean);
  }
  return { routes, stops };
}

function schemeStopName(name) {
  const directionNote = /(?:^|,\s*)(?:в|во|из|к|ко|на|от)\s+\S/iu;
  return name.split(' · ', 1)[0].replace(/\s*\(([^()]*)\)\s*$/u, (suffix, note) =>
    directionNote.test(note.trim()) ? '' : suffix);
}

function stopNameKey(name) {
  const key = normalizeText(name)
    .replace(/\s*\((?:(?:справа|слева)(?:,\s*(?:справа|слева))?|автобусы)\)$/u, '')
    .replace(/^оп\.?\s+/u, '')
    .replace(/^(?:(?:микрорайон|деревня|село|поселок|м\/р)\s+|[дсп]\.\s*)/u, '')
    .replace(/^торговый центр(?=\s|["«])/u, 'тц')
    .replace(/[\s«»"“”,.]/gu, '');
  return key === 'пермскийполитехническийинсти' || key === 'пермскийполитехническийуниверситет'
    ? 'пнипу' : key;
}

export function stopVisits(direction, stops) {
  const registryNames = new Map();
  for (const id of direction.registryStopIds || []) {
    const name = stops.get(id)?.name;
    if (!name) continue;
    const key = stopNameKey(name);
    if (!key) continue;
    registryNames.set(key, registryNames.has(key) && registryNames.get(key) !== name ? null : name);
  }
  return direction.stopIds.flatMap((id, index) => {
    const stop = stops.get(id);
    if (!stop) return [];
    const name = direction.registry ? stop.name : schemeStopName(stop.name);
    const label = registryNames.get(stopNameKey(name)) ?? name;
    return [{ stop, index, label }];
  });
}
