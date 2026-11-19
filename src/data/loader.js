class DataError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DataError';
  }
}

function assert(condition, message) {
  if (!condition) throw new DataError(message);
}

function validCoordinate(point) {
  return Array.isArray(point) && point.length >= 2
    && Number.isFinite(point[0]) && point[0] >= -180 && point[0] <= 180
    && Number.isFinite(point[1]) && point[1] >= -90 && point[1] <= 90;
}

function validateCollection(collection, label) {
  assert(collection?.type === 'FeatureCollection' && Array.isArray(collection.features),
    `${label}: ожидается GeoJSON FeatureCollection.`);
  const ids = new Set();
  for (const feature of collection.features) {
    assert(feature?.type === 'Feature' && feature.properties && typeof feature.properties === 'object',
      `${label}: объект должен быть GeoJSON Feature с properties.`);
    const id = feature.properties.id;
    assert(typeof id === 'string' && id.trim().length > 0, `${label}: отсутствует строковый id.`);
    assert(!ids.has(id), `${label}: повторяется id «${id}».`);
    ids.add(id);
  }
}

function validateRouteCollection(collection) {
  validateCollection(collection, 'Маршруты');
  return collection.features.map((feature) => {
    const { properties, geometry } = feature;
    assert(geometry === null || (geometry && ['LineString', 'MultiLineString'].includes(geometry.type)),
      `Маршрут «${properties.id}»: требуется LineString, MultiLineString или null.`);
    if (geometry !== null) {
      const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
      assert(Array.isArray(lines) && lines.length > 0 && lines.every((line) => (
        Array.isArray(line) && line.length >= 2 && line.every(validCoordinate)
      )), `Маршрут «${properties.id}»: некорректные координаты WGS84.`);
    }
    assert(properties.stopIds === undefined || (Array.isArray(properties.stopIds)
      && properties.stopIds.every((id) => typeof id === 'string')),
    `Маршрут «${properties.id}»: stopIds должен быть массивом строк.`);
    return { ...properties, stopIds: properties.stopIds || [], geometry };
  });
}

function validateStopCollection(collection) {
  validateCollection(collection, 'Остановки');
  return collection.features.map((feature) => {
    const { properties, geometry } = feature;
    assert(geometry === null || (geometry?.type === 'Point' && validCoordinate(geometry.coordinates)),
      `Остановка «${properties.id}»: требуется Point с координатами WGS84 или null.`);
    return { ...properties, name: properties.name || 'Без названия', coordinates: geometry?.coordinates ?? null };
  });
}

export function validateCatalog(catalog) {
  assert(catalog && typeof catalog === 'object' && Array.isArray(catalog.routes) && Array.isArray(catalog.stops),
    'Каталог реестра должен содержать массивы routes и stops.');
  assert([...catalog.routes, ...catalog.stops].every((item) => item && typeof item === 'object' && !Array.isArray(item)),
    'Каждая запись каталога реестра должна быть JSON-объектом.');
  assert(Array.isArray(catalog.sources) && catalog.sources.length > 0,
    'В каталоге реестра не указаны источники.');
  const featureCollection = (items, geometry) => ({
    type: 'FeatureCollection',
    features: items.map((item) => ({ type: 'Feature', properties: item, geometry: geometry(item) })),
  });
  const routes = validateRouteCollection(featureCollection(catalog.routes, (route) => route.geometry ?? null));
  const stops = validateStopCollection(featureCollection(catalog.stops,
    (stop) => stop.coordinates == null ? null : { type: 'Point', coordinates: stop.coordinates }));
  for (const route of routes) {
    assert(route.mapRouteIds === undefined || (Array.isArray(route.mapRouteIds)
      && route.mapRouteIds.every((id) => typeof id === 'string' && id.length)),
    `Маршрут «${route.id}»: mapRouteIds должен быть массивом строк.`);
    assert(route.directions === undefined || (Array.isArray(route.directions)
      && route.directions.every((direction) => typeof direction?.id === 'string'
        && Array.isArray(direction.stopIds) && direction.stopIds.every((id) => typeof id === 'string'))),
    `Маршрут «${route.id}»: некорректные направления остановок.`);
  }
  return { routes, stops };
}
