import { parseArgs } from 'node:util';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collectDirectory } from '../src/lib/directory-collector';
import { directoryPolicySchema } from '../src/lib/directory-model';

const { values } = parseArgs({ options: { previous: { type: 'string' }, output: { type: 'string', default: 'output/directory' }, policy: { type: 'string', default: 'directory/policy.json' }, relay: { type: 'string' } } });
const readJson = async (path: string, limit: number) => {
  if ((await stat(path)).size > limit) throw new Error('Directory input exceeds its size limit.');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
};
const policy = directoryPolicySchema.parse(await readJson(values.policy!, 256_000));
let previous: unknown;
if (values.previous) {
  try { previous = await readJson(values.previous, 16_000_000); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
const result = await collectDirectory({ previous, policy, relay: values.relay });
const output = resolve(values.output!); await mkdir(output, { recursive: true });
for (const [name, value] of [['state', result.state], ['snapshot', result.snapshot]] as const) {
  const target = resolve(output, `${name}.json`);
  await writeFile(`${target}.tmp`, `${JSON.stringify(value)}\n`);
  await rename(`${target}.tmp`, target);
}
// Deliberately omit names, response bodies, URLs, and private app configuration from logs.
console.log(JSON.stringify(result.stats));
