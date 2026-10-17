// Checks the library without its files (CI runs this): every .json is valid and complete, and every file it names is
// in assets.lock.json (so `pull` can fetch it).
//
//   node tools/check.mjs

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, KINDS, readLock } from './lib.mjs';

const lock = readLock();
const problems = [];
let count = 0;

const need = (cond, msg) => { if (!cond) problems.push(msg); };
const inLock = (r, where) => need(lock[r], `${where}: ${r} isn't in assets.lock.json (add it with tools/add.mjs, then push)`);

for (const kind of KINDS) {
  const dir = path.join(ROOT, kind);
  if (!fs.existsSync(dir)) continue;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dir).filter((x) => x.endsWith('.json'))) {
    const r = path.relative(ROOT, f).split(path.sep).join('/');
    let j;
    try {
      j = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
      problems.push(`${r}: not valid JSON (${e.message})`);
      continue;
    }
    count++;
    const here = path.posix.dirname(r);
    need(typeof j.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(j.id), `${r}: id must be lowercase words and dashes`);
    if (kind === 'characters') {
      need(path.basename(r) === 'character.json', `${r}: a character folder has character.json`);
      need(j.model, `${r}: no model`);
      if (j.model) inLock(`${here}/${j.model}`, r);
      if (j.reference) inLock(`${here}/${j.reference}`, r);
      need(j.height === null || typeof j.height === 'number', `${r}: height is meters (a number)`);
    } else if (kind === 'animations') {
      need(j.file && j.rig, `${r}: an animation has file and rig`);
      if (j.file) inLock(`${here}/${j.file}`, r);
    } else {
      need(j.file, `${r}: no file`);
      if (j.file) inLock(`${here}/${j.file}`, r);
    }
  }
}
for (const r of Object.keys(lock)) need(/^[0-9a-f]{64}$/.test(lock[r].sha256) && lock[r].size > 0, `assets.lock.json: ${r} has a bad entry`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok: ${count} entries, ${Object.keys(lock).length} files`);
