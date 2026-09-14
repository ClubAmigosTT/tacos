import { spawn } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const skipDownload = args.has('--skip-download');
const skipDiscovery = args.has('--skip-discovery');
const skipEnrichment = args.has('--skip-enrichment');
const discoveryOffset = process.env.CATALOG_DISCOVERY_OFFSET?.trim();
const discoveryMaxQueries = process.env.CATALOG_DISCOVERY_MAX_QUERIES?.trim();

function executable(command) {
  if (process.platform !== 'win32') return command;
  return command === 'python' ? 'python' : command;
}

function run(command, commandArgs, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===`);
    const child = spawn(executable(command), commandArgs, {
      stdio: 'inherit',
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${label} terminó con ${signal ? `señal ${signal}` : `código ${code}`}`));
    });
  });
}

try {
  if (!skipDownload) await run('python', ['scripts/download-denue.py'], 'Descargar DENUE');
  if (!skipDiscovery) {
    const discoveryArgs = [
      'scripts/discover-taqueria-ids.py',
      '--batch-size', '60',
      '--strategy', 'admin',
      '--grid-step', '0.25',
      '--query-delay', '2',
      '--request-timeout', '180',
      '--endpoint-retries', '2'
    ];
    if (discoveryOffset) discoveryArgs.push('--query-offset', discoveryOffset);
    if (discoveryMaxQueries) discoveryArgs.push('--max-queries', discoveryMaxQueries);
    await run('python', discoveryArgs, 'Descubrir OSM');
  }
  if (!skipEnrichment) {
    await run('python', ['scripts/enrich-taqueria-ids.py', '--batch-size', '60'], 'Enriquecer OSM');
  }
  await run('node', ['scripts/build-osm-catalog.mjs'], 'Construir catálogo OSM');
  await run('python', ['scripts/build-denue-catalog.py', '--include-osm', '--include-osm-candidates', '--output', 'catalog/cdmx-edomex.json'], 'Combinar DENUE + OSM');
  await run('python', ['scripts/audit-catalog.py'], 'Auditar catálogo');
  console.log('\nCatálogo actualizado correctamente. La importación a producción queda como paso explícito separado.');
} catch (error) {
  console.error(`\nERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
