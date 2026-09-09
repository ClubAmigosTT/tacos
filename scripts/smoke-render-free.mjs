import { readFile } from 'node:fs/promises';

const blueprint = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');
const demoBlueprint = await readFile(new URL('../render.free-demo.yaml', import.meta.url), 'utf8');

// Keep this guard dependency-free so it runs on a fresh Windows checkout as
// well as in CI. The official Render CLI/YAML validator remains the source of
// truth for complete Blueprint syntax; this smoke test protects the cost
// policy that must not regress accidentally.
const paidPlan = /(?:plan:\s*(?:0\.5c-512mb|0\.5c-1g|256mb|1g|5g|10g|20g|40g)|preDeployCommand:)/;
if (paidPlan.test(blueprint) || paidPlan.test(demoBlueprint)) throw new Error('Free Blueprint contains a paid plan or paid-only preDeployCommand');
if ((blueprint.match(/^\s*- type:\s+/gm) ?? []).length !== 1 || !/^\s*- type:\s+web\s*$/m.test(blueprint)) {
  throw new Error('Free Blueprint must contain exactly one web service');
}
if (!/^\s*plan:\s+free\s*$/m.test(blueprint)) throw new Error('Web service is not on the Free plan');
if (!/databases:[\s\S]*?^\s*plan:\s+free\s*$/m.test(blueprint)) throw new Error('PostgreSQL is not on the Free plan');
if (!/^\s*- key:\s+STORAGE_REQUIRED\s*\n\s+value:\s+"false"\s*$/m.test(blueprint)) throw new Error('Storage must remain optional in the Free MVP');
if (!/^\s*name:\s+tacos-api-free\s*$/m.test(demoBlueprint) || !/^\s*name:\s+tacos-postgres-free\s*$/m.test(demoBlueprint)) throw new Error('Free demo Blueprint resource names changed unexpectedly');
if (!/^\s*- key:\s+REQUIRE_EMAIL_VERIFICATION\s*\n\s+value:\s+"false"\s*$/m.test(demoBlueprint)) throw new Error('Free demo must remain explicit about deferred email verification');
if (!/^\s*- key:\s+ALLOW_DEMO_CATALOG\s*\n\s+value:\s+"true"\s*$/m.test(demoBlueprint)) throw new Error('Free demo must expose the seeded catalog for first-run testing');

console.log('Render Free smoke passed: API + PostgreSQL only, no paid resources');
