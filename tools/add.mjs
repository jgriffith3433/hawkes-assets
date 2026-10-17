// Adds a file to the library: copies it into place, looks inside it with Blender (rigs, animations, size), writes its
// .json and records it in assets.lock.json. Then `node tools/sync.mjs push` and commit.
//
//   node tools/add.mjs character <id> <model> [--name "..."] [--project phorigins] [--look "..."] [--reference sheet.png]
//   node tools/add.mjs animation <file> [--id walk] [--rig mixamo]
//   node tools/add.mjs prop <id> <file> [--name "..."] [--project ...]
//   node tools/add.mjs set <id> <file.blend|glb> [--name "..."] [--project ...]
//   node tools/add.mjs sky <id> <equirect image> [--name "..."]
//
// --source records where the file came from (default: the path given, relative to C:\Projects).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, readLock, writeLock, sha256, rel, blender } from './lib.mjs';

const args = process.argv.slice(2);
const opts = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[++i];
  else pos.push(args[i]);
}
const [kind] = pos;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const projectsDir = path.resolve(ROOT, '..');
const sourceOf = (f) => opts.source ?? path.relative(projectsDir, path.resolve(f)).split(path.sep).join('/');

function inspect(file) {
  const out = path.join(os.tmpdir(), `hawkes-assets-${process.pid}.json`);
  const r = spawnSync(blender(), ['-b', '--factory-startup', '-P', path.join(ROOT, 'tools', 'inspect.py'), '--', path.resolve(file), out], { encoding: 'utf8' });
  if (!fs.existsSync(out)) throw new Error(`Blender couldn't read ${file}:\n${(r.stdout + r.stderr).split('\n').slice(-15).join('\n')}`);
  const info = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  return info;
}

function place(src, destRel) {
  const dest = path.join(ROOT, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return dest;
}

async function record(files) {
  const lock = readLock();
  for (const f of files) lock[rel(f)] = { sha256: await sha256(f), size: fs.statSync(f).size };
  writeLock(lock);
}

const writeJson = (r, data) => {
  const f = path.join(ROOT, r);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 1) + '\n');
  console.log(`wrote ${r}`);
};

async function main() {
  if (kind === 'character') {
    const [, id, file] = pos;
    if (!id || !file) throw new Error('node tools/add.mjs character <id> <model>');
    const info = inspect(file);
    const ext = path.extname(file).toLowerCase();
    const model = place(file, `characters/${id}/model${ext}`);
    const files = [model];
    let reference = null;
    if (typeof opts.reference === 'string') {
      reference = `reference${path.extname(opts.reference).toLowerCase()}`;
      files.push(place(opts.reference, `characters/${id}/${reference}`));
    }
    const rig = info.rigs[0] ?? null;
    writeJson(`characters/${id}/character.json`, {
      id, name: typeof opts.name === 'string' ? opts.name : id,
      projects: typeof opts.project === 'string' ? opts.project.split(',') : [],
      model: `model${ext}`, reference,
      rig: rig ? rig.family : null,
      height: info.size ? info.size[2] : null,
      facing: 0,
      animations: info.animations.map((a) => a.name),
      look: typeof opts.look === 'string' ? opts.look : '',
      source: sourceOf(file),
    });
    await record(files);
  } else if (kind === 'animation') {
    const [, file] = pos;
    if (!file) throw new Error('node tools/add.mjs animation <file>');
    const info = inspect(file);
    const rig = typeof opts.rig === 'string' ? opts.rig : info.rigs[0]?.family ?? 'custom';
    const id = typeof opts.id === 'string' ? opts.id : slug(path.basename(file, path.extname(file)));
    const ext = path.extname(file).toLowerCase();
    const dest = place(file, `animations/${rig}/${id}${ext}`);
    const act = info.rigs[0]?.action ?? info.animations[0]?.name ?? null;
    const a = info.animations.find((x) => x.name === act) ?? info.animations[0];
    writeJson(`animations/${rig}/${id}.json`, {
      id, rig, file: `${id}${ext}`, action: act, frames: a?.frames ?? null, fps: info.fps,
      // Mixamo and Biped exports often carry the character too; it's dropped when the clip is played on another one.
      withCharacter: info.meshes > 0,
      source: sourceOf(file),
    });
    await record([dest]);
  } else if (['prop', 'set', 'sky'].includes(kind)) {
    const [, id, file] = pos;
    if (!id || !file) throw new Error(`node tools/add.mjs ${kind} <id> <file>`);
    const ext = path.extname(file).toLowerCase();
    const folder = { prop: 'props', set: 'sets', sky: 'skies' }[kind];
    if (kind === 'sky') {
      const dest = place(file, `skies/${id}${ext}`);
      writeJson(`skies/${id}.json`, { id, name: typeof opts.name === 'string' ? opts.name : id, file: `${id}${ext}`, projection: 'equirect', source: sourceOf(file) });
      await record([dest]);
      return;
    }
    const info = inspect(file);
    const name = kind === 'set' ? `scene${ext}` : `model${ext}`;
    const dest = place(file, `${folder}/${id}/${name}`);
    writeJson(`${folder}/${id}/${kind}.json`, {
      id, name: typeof opts.name === 'string' ? opts.name : id,
      projects: typeof opts.project === 'string' ? opts.project.split(',') : [],
      file: name, size: info.size,
      source: sourceOf(file),
    });
    await record([dest]);
  } else {
    throw new Error('node tools/add.mjs character|animation|prop|set|sky ...');
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
