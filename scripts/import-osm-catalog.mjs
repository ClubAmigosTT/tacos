process.env.CATALOG_FILE ??= 'catalog/osm-cdmx-edomex.json';
process.env.CATALOG_SOURCE_NAME ??= 'osm-cdmx-edomex';
process.env.CATALOG_SOURCE_URL ??= 'https://www.openstreetmap.org';
process.env.CATALOG_SOURCE_LICENSE ??= 'ODbL 1.0';
process.env.CATALOG_ALLOW_PARTIAL ??= 'true';

await import('./import-catalog.mjs');
