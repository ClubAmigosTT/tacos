import { closeRepository, runNightlyMaintenance } from './repository.js';

// The worker is deliberately separate from HTTP traffic. Until a queue is
// needed, it runs the same bounded maintenance loop on a slower cadence.
async function tick() {
  try {
    const result = await runNightlyMaintenance();
    console.log(JSON.stringify({ job: 'tacos-worker-maintenance', ...result, completedAt: new Date().toISOString() }));
  } catch (error) {
    console.error('tacos-worker maintenance failed', error);
  }
}

await tick();
const timer = setInterval(() => { void tick(); }, 15 * 60_000);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  await closeRepository();
  process.exit(0);
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
