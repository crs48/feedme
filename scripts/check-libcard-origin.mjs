import { checkLibcardEndpoint, contractOrigin } from './libcard-contract.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error('Usage: pnpm check:libcard-origin https://your-personal-feedme-origin');
  const origin = contractOrigin(args[0]);
  const body = await checkLibcardEndpoint(origin);
  console.log(`LibCard contract passed at ${origin}: GET/HEAD 200 without redirects, public cache, matching origin, ${body.targets.length} live targets, and a valid response allowlist.`);
  console.log('This read-only check verifies integration compatibility, not live Stripe/Habitat setup or payment readiness.');
} catch (error) {
  console.error(`LibCard endpoint check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
}
