import { closeRepository, runNightlyMaintenance } from './repository.js';

try {
  const result = await runNightlyMaintenance();
  console.log(JSON.stringify({ job: 'tacos-nightly', ...result, completedAt: new Date().toISOString() }));
} finally {
  await closeRepository();
}
