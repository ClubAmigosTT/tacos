const genericNameTokens = new Set([
  'a', 'al', 'antojito', 'antojitos', 'bar', 'carnita', 'carnitas', 'carne',
  'comida', 'comidas', 'con', 'cocina', 'de', 'del', 'desayuno', 'desayunos',
  'el', 'en', 'fonda', 'food', 'horas', 'la', 'las', 'los', 'mexicana',
  'mexicano', 'mexicanos', 'puesto', 'restaurant', 'restaurante',
  'restaurantes', 'sin', 'suadero', 'taco', 'tacos', 'taqueria', 'tortas',
  'y', 'barbacoa', 'birria', 'pastor', 'canasta'
]);

const genericExactNames = new Set([
  'antojito', 'antojitos', 'barbacoa', 'birria', 'carnitas', 'comida',
  'comida mexicana', 'comidas', 'cocina economica', 'desayuno', 'desayunos',
  'food truck', 'mexicana', 'mexicano', 'puesto de tacos', 'restaurant',
  'restaurante', 'restaurantes', 'suadero', 'taco', 'tacos', 'taqueria',
  'tortas', 'tacos de canasta', 'zona de comida'
]);

function normalize(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isDisplayableCatalogPlace(place: { name?: unknown; taqueriaName?: unknown }) {
  const normalized = normalize(place.name ?? place.taqueriaName);
  if (!normalized || genericExactNames.has(normalized)) return false;
  return normalized.split(' ').some((token) => !genericNameTokens.has(token) && !/^\d+$/.test(token) && token.length >= 2);
}
