import region from '../config/regions/perm.js';
import { loadPassengerCatalog, loadPassengerNetwork, loadPassengerShape } from './data/passenger.js';
import { buildScheduleCatalog, departureOrigins, stopVisits } from './domain/schedules.js';
import { formatDisplayText, normalizeText, searchRoutes } from './domain/transport.js';

const calendarLabels = new Map([
  ['будние дни', 'Будни'],
  ['рабочие дни', 'Будни'],
  ['рабочие дни пн-пт', 'Будни'],
  ['субботние дни', 'Суббота'],
  ['воскресные и праздничные дни', 'Воскресенье и праздники'],
  ['субботние, воскресные дни', 'Выходные'],
  ['суббота, воскресенье и праздн. дни', 'Выходные и праздники'],
  ['суббота, воскресенье и праздничные дни', 'Выходные и праздники'],
  ['субботние воскресные и праздничные дни', 'Выходные и праздники'],
  ['субботние, воскресные и праздничные дни', 'Выходные и праздники'],
]);

const $ = id => document.getElementById(id);
const filter = $('route-filter');
const filterLabel = $('route-filter-label');
const routeOptions = $('route-options');
const selectedRoute = $('selected-route');
const clearRouteButton = $('clear-route');
const routeCard = $('route-card');
const directionButtons = $('route-directions');
const stopList = $('stop-list');
const departures = $('departure-content');
const mapPanel = $('stop-map');
const mapStatus = $('stop-map-status');
const fitMap = $('fit-route-map');
let mapStylePromise;
let catalog;
let route;
let origins;
let visits;
let selectedVisit;
let map;
let mapRequest = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = formatDisplayText(text);
  if (className) node.className = className;
  return node;
}

function renderRoutes() {
  const query = filter.value.trim().replace(/^№\s*/u, '');
  const matches = query ? searchRoutes(catalog.routes, query) : [];
  routeOptions.replaceChildren(...matches.slice(0, 8).map(item => {
    const row = element('li');
    const button = element('button', `№${item.ref} ${item.name}`);
    button.type = 'button';
    button.addEventListener('click', () => selectRoute(item));
    row.append(button);
    return row;
  }));
  routeOptions.hidden = !matches.length;
  $('route-status').textContent = query && !matches.length ? 'Маршруты не найдены.'
    : matches.length > 8 ? 'Показаны первые 8 маршрутов. Уточните запрос.' : '';
}

function closeSuggestions() {
  if (routeOptions.hidden) return;
  routeOptions.hidden = true;
  $('route-status').textContent = '';
}

function selectRoute(item) {
  route = item;
  closeSuggestions();
  filter.hidden = filterLabel.hidden = true;
  selectedRoute.replaceChildren(
    element('span', `№${item.ref}`, 'selected-route-number'),
    ' ',
    element('span', item.name),
  );
  selectedRoute.hidden = clearRouteButton.hidden = false;
  const season = $('route-caution');
  season.hidden = !(item.seasonal && item.season?.startMonthDay && item.season?.endMonthDay);
  season.textContent = season.hidden ? ''
    : `Сезон движения ${item.season.startMonthDay.slice(3)}.${item.season.startMonthDay.slice(0, 2)}–${item.season.endMonthDay.slice(3)}.${item.season.endMonthDay.slice(0, 2)}`;
  routeCard.hidden = false;
  directionButtons.replaceChildren(...route.directions.map(({ label }, index) => {
    const button = element('button', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') !== 'true') selectDirection(index);
    });
    return button;
  }));
  directionButtons.hidden = !route.directions.length;
  selectDirection(0);
  const nextControl = directionButtons.firstElementChild || clearRouteButton;
  nextControl.focus({ preventScroll: true });
}

function selectDirection(index) {
  const direction = route.directions[index];
  [...directionButtons.children].forEach((button, position) =>
    button.setAttribute('aria-pressed', String(position === index)));
  selectedVisit = undefined;
  visits = direction ? stopVisits(direction, catalog.stops) : [];
  origins = direction ? departureOrigins(route.schedule, direction.sheetDirectionId) : [];
  renderStops(direction);
  renderSchedule();
  void renderMap(direction);
}

function renderStops(direction) {
  stopList.replaceChildren(...visits.map(({ stop, index, label }, position) => {
    const row = element('li');
    const entry = element(stop.coordinates ? 'button' : 'div', '', 'stop-row');
    const number = element('span', String(position + 1), 'stop-number');
    number.setAttribute('aria-hidden', 'true');
    entry.append(number, element('span', label));
    if (stop.coordinates) {
      entry.type = 'button';
      entry.dataset.visitIndex = index;
      entry.setAttribute('aria-pressed', 'false');
      entry.addEventListener('click', () => selectStop(index, { reveal: true }));
    }
    row.append(entry);
    return row;
  }));
  $('stop-status').textContent = '';
  const note = $('stop-list-note');
  note.textContent = '';
  if (!visits.length) note.textContent = 'Список остановок недоступен.';
  else if (direction.registry && direction.travelSequenceVerified !== true) {
    note.textContent = 'Порядок движения по реестровому списку не подтверждён.';
  }
}

function selectStop(index, { reveal = false } = {}) {
  selectedVisit = visits.find(visit => visit.index === index);
  if (!selectedVisit) return;
  for (const button of stopList.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.visitIndex) === index));
  }
  $('stop-status').textContent = origins.length ? 'Время на этой остановке неизвестно.' : '';
  map?.selectStop(index, { center: reveal });
  if (reveal && !mapPanel.hidden) mapPanel.scrollIntoView({ block: 'nearest' });
}

function renderSchedule() {
  departures.replaceChildren();
  if (!origins.length) {
    departures.append(element('p', 'Расписание пока отсутствует.'));
    return;
  }
  if (origins.length === 1) {
    renderDepartures(departures, origins[0], { showOrigin: true });
    return;
  }
  const originField = element('div', '', 'field');
  const originLabel = element('label', 'Место отправления');
  originLabel.htmlFor = 'schedule-origin';
  const originSelect = element('select');
  originSelect.id = 'schedule-origin';
  originSelect.append(...origins.map((origin, index) => new Option(formatDisplayText(origin.label), String(index))));
  originField.append(originLabel, originSelect);
  const details = element('div');
  originSelect.addEventListener('change', () => renderDepartures(details, origins[originSelect.value]));
  departures.append(originField, details);
  renderDepartures(details, origins[0]);
}

function renderDepartures(container, choice, { showOrigin = false } = {}) {
  container.replaceChildren();
  if (showOrigin) container.append(element('h3', choice.label));
  const days = element('div', '', 'schedule-calendars');
  days.setAttribute('role', 'group');
  days.setAttribute('aria-label', 'Дни по расписанию');
  const times = element('ul', '', 'departure-times');

  function selectDay(button, entries) {
    for (const day of days.children) day.setAttribute('aria-pressed', String(day === button));
    times.replaceChildren(...entries.map(entry => {
      const item = element('li');
      const time = element('time', entry.time);
      time.dateTime = entry.time;
      item.append(time);
      if (entry.note && entry.note !== `с ${choice.label}`) item.append(element('small', entry.note));
      return item;
    }));
  }

  for (const [day, entries] of choice.calendars) {
    const button = element('button', calendarLabels.get(normalizeText(day)) || day);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => selectDay(button, entries));
    days.append(button);
    if (days.children.length === 1) selectDay(button, entries);
  }
  container.append(days, times);
}

function resetMap() {
  mapRequest++;
  map?.clear();
  mapPanel.hidden = true;
  fitMap.hidden = true;
  mapStatus.textContent = '';
}

function loadMapStyle() {
  mapStylePromise ??= new Promise((resolve, reject) => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('../vendor/openlayers/ol.css', import.meta.url).href;
    stylesheet.addEventListener('load', resolve, { once: true });
    stylesheet.addEventListener('error', () => {
      stylesheet.remove();
      reject(new Error('Не удалось загрузить стили карты.'));
    }, { once: true });
    document.head.append(stylesheet);
  }).catch(error => {
    mapStylePromise = undefined;
    throw error;
  });
  return mapStylePromise;
}

async function renderMap(direction) {
  resetMap();
  const request = mapRequest;
  const mappedVisits = visits.filter(({ stop }) => stop.coordinates);
  if (!direction?.shapeId && !mappedVisits.length) {
    mapStatus.textContent = 'Карта для этого направления недоступна.';
    return;
  }
  mapPanel.hidden = false;
  mapStatus.textContent = 'Загружаем карту…';
  try {
    const [module, lines] = await Promise.all([
      import('./map/journey-map.js'),
      direction.shapeId ? loadPassengerShape(direction.shapeId) : [],
      loadMapStyle(),
    ]);
    if (request !== mapRequest) return;
    if (!lines.length && !mappedVisits.length) {
      mapPanel.hidden = true;
      mapStatus.textContent = 'Линию направления загрузить не удалось.';
      return;
    }
    map ??= module.createJourneyMap('stop-map', region, {
      onStopSelect: selectStop,
      onOverviewChange: isOverview => { fitMap.hidden = isOverview; },
    });
    map.showDirection(lines, mappedVisits);
    mapStatus.textContent = lines.length ? '' : 'Показаны остановки. Линия направления недоступна.';
    if (selectedVisit) map.selectStop(selectedVisit.index, { center: true });
  } catch {
    if (request !== mapRequest) return;
    resetMap();
    mapStatus.textContent = 'Не удалось открыть карту.';
  }
}

fitMap.addEventListener('click', () => {
  map.fitOverview();
  mapPanel.focus({ preventScroll: true });
});
clearRouteButton.addEventListener('click', () => {
  resetMap();
  route = undefined;
  routeCard.hidden = true;
  selectedRoute.hidden = clearRouteButton.hidden = true;
  filter.hidden = filterLabel.hidden = false;
  filter.value = '';
  renderRoutes();
  filter.focus();
});
filter.addEventListener('input', renderRoutes);
filter.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !routeOptions.hidden) {
    event.preventDefault();
    closeSuggestions();
  }
  if (event.key === 'ArrowDown' && !routeOptions.hidden) {
    event.preventDefault();
    routeOptions.querySelector('button')?.focus();
  }
});
routeOptions.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSuggestions();
    filter.focus();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const buttons = [...routeOptions.querySelectorAll('button')];
  const current = buttons.indexOf(document.activeElement);
  const next = current + (event.key === 'ArrowDown' ? 1 : -1);
  if (next < 0) filter.focus();
  else buttons[Math.min(next, buttons.length - 1)]?.focus();
});

document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.schedule-search')) closeSuggestions();
});

async function start() {
  $('retry-schedule').hidden = true;
  $('route-status').textContent = 'Загружаем маршруты…';
  try {
    const [registry, network] = await Promise.all([loadPassengerCatalog(), loadPassengerNetwork()]);
    catalog = buildScheduleCatalog(registry, network);
    filter.disabled = false;
    $('route-status').textContent = '';
  } catch {
    $('route-status').textContent = 'Не удалось загрузить маршруты.';
    $('retry-schedule').hidden = false;
  }
}

$('retry-schedule').addEventListener('click', start);
void start();
