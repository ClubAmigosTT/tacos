import { readFile } from 'node:fs/promises';

const blueprint = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');
const demoBlueprint = await readFile(new URL('../render.free-demo.yaml', import.meta.url), 'utf8');

// Keep this guard dependency-free so it runs on a fresh Windows checkout as
// well as in CI. The official Render CLI/YAML validator remains the source of
// truth for complete Blueprint syntax; this smoke test protects the cost
// policy that must not regress accidentally.
const paidPlan = /(?:plan:\s*(?:0\.5c-512mb|0\.5c-1g|256mb|1g|5g|10g|20g|40g)|preDeployCommand:)/;
if (paidPlan.test(blueprint) || paidPlan.test(demoBlueprint)) throw new Error('Free Blueprint contains a paid plan or paid-only preDeployCommand');
const productionWebServices = blueprint.match(/^\s*- type:\s+web\s*$/gm) ?? [];
if (productionWebServices.length !== 2 || !/^\s*name:\s+tacos-web\s*$/m.test(blueprint) || !/^\s*name:\s+tacos-api\s*$/m.test(blueprint)) {
  throw new Error('Production Free Blueprint must contain exactly the web API and static frontend');
}
if (!/name:\s+tacos-api[\s\S]*?plan:\s+free\s*/m.test(blueprint)) throw new Error('API service is not on the Free plan');
if (/^databases:\s*$/m.test(blueprint)) throw new Error('Production Blueprint must use persistent external PostgreSQL instead of temporary Render Free PostgreSQL');
if (!/- key:\s+DATABASE_URL\s*\n\s+#(?:.*\n)*?\s*sync:\s+false/m.test(blueprint)) throw new Error('Production DATABASE_URL must be supplied securely from external PostgreSQL');
if (!/^\s*autoDeployTrigger:\s+commit\s*$/m.test(blueprint)) throw new Error('Production API must deploy directly from commits without depending on paid Actions minutes');
if (!/^\s*- key:\s+STORAGE_REQUIRED\s*\n\s+value:\s+"false"\s*$/m.test(blueprint)) throw new Error('Storage must remain optional in the Free MVP');
if (!/^\s*name:\s+tacos-api-free\s*$/m.test(demoBlueprint) || !/^\s*name:\s+tacos-postgres-free\s*$/m.test(demoBlueprint)) throw new Error('Free demo Blueprint resource names changed unexpectedly');
if (!/^\s*- key:\s+REQUIRE_EMAIL_VERIFICATION\s*\n\s+value:\s+"false"\s*$/m.test(demoBlueprint)) throw new Error('Free demo must remain explicit about deferred email verification');
if (!/^\s*- key:\s+ALLOW_DEMO_CATALOG\s*\n\s+value:\s+"true"\s*$/m.test(demoBlueprint)) throw new Error('Free demo must expose the seeded catalog for first-run testing');

console.log('Render Free smoke passed: static frontend + API + external PostgreSQL, no paid Render resources');
