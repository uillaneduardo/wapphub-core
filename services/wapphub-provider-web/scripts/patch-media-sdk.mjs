import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL, pathToFileURL } from 'node:url';
import { log } from 'node:console';
const require = createRequire(import.meta.url);
const entry = require.resolve('baileys');
const root = new URL('../', pathToFileURL(entry));
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (manifest.version !== '7.0.0-rc14') throw new Error('REVIEW_MEDIA_SDK_PATCH_FOR_NEW_VERSION');
const file = new URL('lib/Utils/messages-media.js', root);
let source = await readFile(file, 'utf8');
const patches = [
  ["const response = await fetch(url.toString(), {\n        dispatcher: options.dispatcher,", "const response = await fetch(url.toString(), {\n        ...options, // WappHub: preserve media abort/redirect policy\n        dispatcher: options.dispatcher,"],
  ["throw new Boom(`Failed to fetch stream from ${url}`,", "await response.body?.cancel(); // WappHub: close rejected media responses\n        throw new Boom(`Failed to fetch stream from ${url}`,"],
  ["return fetched.pipe(output, { end: true });", "fetched.once('error', error => output.destroy(error)); // WappHub: propagate remote errors\n    output.once('close', () => fetched.destroy()); // WappHub: stop upstream on cancellation\n    return fetched.pipe(output, { end: true });"],
];
for (const [before, after] of patches) {
  if (source.includes(after)) continue;
  if (source.split(before).length !== 2) throw new Error('MEDIA_SDK_PATCH_CONTEXT_CHANGED');
  source = source.replace(before, after);
}
await writeFile(file, source);
log('Pinned Baileys media abort/redirect patch verified');
