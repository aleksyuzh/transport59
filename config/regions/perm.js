export default Object.freeze({
  map: Object.freeze({
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    passengerCenter: [56.25, 58.01],
  }),
  dataBaseUrl: new URL('../../data/perm/', import.meta.url).href,
});
