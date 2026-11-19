export function formatDisplayText(value = '') {
  return String(value)
    .replaceAll('\u2014', '–')
    .replace(/\s+-\s+|(?<=\S)\s+-(?=\p{L})|(?<=\p{L})-\s+(?=\p{L})/gu, ' – ');
}

export function normalizeText(value = '') {
  return formatDisplayText(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/\s+/gu, ' ')
    .trim();
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

function matches(value, query) {
  const text = normalizeText(value);
  return normalizeText(query).split(' ').every((part) => text.includes(part));
}

export function searchRoutes(routes, query = '') {
  const normalized = normalizeText(query);
  return routes.filter((route) => matches(
    [route.ref, route.name, route.from, route.to, ...(Array.isArray(route.searchTerms) ? route.searchTerms : [route.searchTerms])].filter(Boolean).join(' '),
    normalized,
  )).sort((a, b) => {
    const exactA = normalized && normalizeText(a.ref) === normalized ? 1 : 0;
    const exactB = normalized && normalizeText(b.ref) === normalized ? 1 : 0;
    return exactB - exactA || collator.compare(a.ref || a.name, b.ref || b.name)
      || collator.compare(a.id, b.id);
  });
}
