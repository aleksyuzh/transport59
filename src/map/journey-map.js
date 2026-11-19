import ol from '../../vendor/openlayers/ol.js';
import { formatDisplayText } from '../domain/transport.js';

export function createJourneyMap(target, region, { onStopSelect, onOverviewChange }) {
  const projection = coordinate => ol.proj.fromLonLat(coordinate);
  const tiles = new ol.source.OSM({ url: region.map.tileUrl });
  const source = new ol.source.Vector();
  const view = new ol.View({
    center: projection(region.map.passengerCenter),
    zoom: 11, minZoom: 6, maxZoom: 19,
  });
  const map = new ol.Map({
    target, view,
    layers: [new ol.layer.Tile({ source: tiles }), new ol.layer.Vector({ source })],
    controls: [new ol.control.Zoom(), new ol.control.Attribution({ collapsible: false })],
  });
  let overview;
  const observer = new ResizeObserver(() => {
    const wasAtOverview = isOverview();
    const previousSize = map.getSize();
    map.updateSize();
    if (wasAtOverview && map.getSize()?.some((size, index) => size !== previousSize?.[index])) fitOverview();
  });
  observer.observe(map.getTargetElement());
  map.on('moveend', () => {
    if (overview) onOverviewChange?.(isOverview());
  });

  function isOverview() {
    if (!overview) return false;
    const [x, y] = view.getCenter();
    const [overviewX, overviewY] = overview.center;
    return Math.hypot(x - overviewX, y - overviewY) <= overview.resolution
      && Math.abs(view.getResolution() / overview.resolution - 1) < .001
      && Math.abs(view.getRotation()) < .005;
  }

  function fitOverview() {
    view.cancelAnimations();
    view.setRotation(0);
    view.fit(source.getExtent(), { padding: [32, 32, 32, 32], maxZoom: 15 });
    overview = { center: [...view.getCenter()], resolution: view.getResolution() };
    onOverviewChange?.(true);
  }

  const directionColor = getComputedStyle(map.getTargetElement()).getPropertyValue('--accent').trim() || '#267A61';
  const stopStyle = new ol.style.Style({
    zIndex: 4,
    image: new ol.style.Circle({
      radius: 5, fill: new ol.style.Fill({ color: '#fff' }),
      stroke: new ol.style.Stroke({ color: directionColor, width: 2 }),
    }),
  });
  const selectedStyle = new ol.style.Style({
    zIndex: 9,
    image: new ol.style.Circle({
      radius: 9, fill: new ol.style.Fill({ color: directionColor }),
      stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
    }),
  });
  const stopMarkers = new Map();
  let selectedMarker;
  let stopOverlay;
  if (onStopSelect) {
    const bubble = document.createElement('div');
    bubble.className = 'map-stop-bubble';
    bubble.setAttribute('role', 'status');
    stopOverlay = new ol.Overlay({
      element: bubble,
      className: 'ol-overlay-container map-stop-overlay',
      positioning: 'bottom-center',
      offset: [0, -16],
      stopEvent: false,
    });
    map.addOverlay(stopOverlay);
    const stopAt = pixel => map.forEachFeatureAtPixel(pixel, feature =>
      feature.get('visitIndex') === undefined ? undefined : feature, { hitTolerance: 6 });
    map.on('singleclick', event => {
      const stop = stopAt(event.pixel);
      if (stop) onStopSelect(stop.get('visitIndex'));
    });
    map.on('pointermove', event => {
      if (!event.dragging) map.getTargetElement().style.cursor = stopAt(event.pixel) ? 'pointer' : '';
    });
  }

  function addLines(lines, color) {
    const line = new ol.Feature(new ol.geom.MultiLineString(lines.map(part => part.map(projection))));
    line.setStyle([
      new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#fff', width: 9 }) }),
      new ol.style.Style({ stroke: new ol.style.Stroke({ color, width: 5 }) }),
    ]);
    source.addFeature(line);
  }

  function clear() {
    view.cancelAnimations();
    overview = undefined;
    onOverviewChange?.(true);
    source.clear();
    stopMarkers.clear();
    selectedMarker = undefined;
    stopOverlay?.setPosition(undefined);
    map.getTargetElement().style.cursor = '';
  }

  return {
    clear,
    fitOverview,
    showDirection(lines, visits) {
      clear();
      if (lines.length) addLines(lines, directionColor);
      for (const { stop, index, label } of visits) {
        const feature = new ol.Feature({
          geometry: new ol.geom.Point(projection(stop.coordinates)),
          visitIndex: index,
          stopLabel: formatDisplayText(label),
        });
        feature.setStyle(stopStyle);
        stopMarkers.set(index, feature);
      }
      source.addFeatures([...stopMarkers.values()]);
      map.updateSize();
      fitOverview();
    },
    selectStop(index, { center = false } = {}) {
      selectedMarker?.setStyle(stopStyle);
      selectedMarker = stopMarkers.get(index);
      if (!selectedMarker) return;
      selectedMarker.setStyle(selectedStyle);
      const coordinate = selectedMarker.getGeometry().getCoordinates();
      if (center) {
        view.cancelAnimations();
        view.setCenter(coordinate);
        view.setZoom(Math.max(view.getZoom(), 15));
      }
      if (stopOverlay) {
        stopOverlay.getElement().textContent = selectedMarker.get('stopLabel');
        stopOverlay.setPosition(coordinate);
        if (!center) stopOverlay.panIntoView({ margin: 12, animation: { duration: 150 } });
      }
    },
  };
}
