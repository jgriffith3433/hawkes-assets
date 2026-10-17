// Shared by the tools: where things are, the lock, hashing, S3 and Blender.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCK = path.join(ROOT, 'assets.lock.json');
export const BUCKET = process.env.HAWKES_ASSETS_BUCKET ?? 'hawkes-assets-028793236279';
export const REGION = 'us-east-1';
export const KINDS = ['characters', 'animations', 'props', 'sets', 'skies'];
/** Files that live in S3, not git (the same list as .gitignore). */
export const BINARY = /\.(glb|gltf|bin|fbx|obj|mtl|blend|usd[acz]?|png|jpe?g|webp|exr|hdr|tga|tiff?|mp4|wav|mp3|zip)$/i;

/** assets.lock.json: repo-relative path (forward slashes) -> { sha256, size }. */
export function readLock() {
  return fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : {};
}
export function writeLock(lock) {
  const sorted = Object.fromEntries(Object.keys(lock).sort().map((k) => [k, lock[k]]));
  fs.writeFileSync(LOCK, JSON.stringify(sorted, null, 1) + '\n');
}

/**
 * Folders tracked where they are (mounts.json: library path -> folder, relative to this repo): the art folders next
 * to this repo (C:\Projects\AllTheCharacters, and /srv/hawkes/AllTheCharacters on the server), so the projects' own
 * tools keep their paths. Every file in a mount lives in S3, whatever its type: the folders aren't in git.
 */
export const MOUNTS = fs.existsSync(path.join(ROOT, 'mounts.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'mounts.json'), 'utf8')) : {};
const mountDirs = Object.entries(MOUNTS).map(([key, dir]) => [key, path.resolve(ROOT, dir)]);

export const rel = (abs) => {
  const a = path.resolve(abs);
  for (const [key, dir] of mountDirs) if (a === dir || a.startsWith(dir + path.sep)) return [key, ...path.relative(dir, a).split(path.sep)].join('/');
  return path.relative(ROOT, a).split(path.sep).join('/');
};
export const abs = (r) => {
  for (const [key, dir] of mountDirs) if (r.startsWith(key + '/')) return path.join(dir, ...r.slice(key.length + 1).split('/'));
  return path.join(ROOT, ...r.split('/'));
};

export function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Every file that lives in S3: binaries under the library folders, and everything in the mounts. */
export function binaries() {
  const out = [];
  const walk = (dir, all) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, all);
      else if (e.isFile() && (all || BINARY.test(e.name)) && !e.name.endsWith('.part')) out.push(rel(p));
    }
  };
  for (const k of KINDS) walk(path.join(ROOT, k), false);
  for (const [, dir] of mountDirs) walk(dir, true);
  return out.sort();
}

/** AWS credentials: the environment, else hawkesgen/.env next to this repo, else the default chain (the control
 * server's instance role). */
function awsCredentials() {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return undefined;
  const envFile = path.join(ROOT, '..', 'hawkesgen', '.env');
  if (!fs.existsSync(envFile)) return undefined;
  const vars = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
  if (vars.AWS_ACCESS_KEY_ID && vars.AWS_SECRET_ACCESS_KEY) return { accessKeyId: vars.AWS_ACCESS_KEY_ID, secretAccessKey: vars.AWS_SECRET_ACCESS_KEY };
  return undefined;
}

let client = null;
export async function s3() {
  if (!client) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const credentials = awsCredentials();
    client = new S3Client({ region: REGION, ...(credentials ? { credentials } : {}) });
  }
  return client;
}
/** Files are stored by content, so the same file in two places (or two versions) is stored once per version. */
export const keyOf = (sha) => `sha256/${sha}`;

/** Blender: BLENDER, else the usual install places. */
export function blender() {
  const found = [process.env.BLENDER, 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe', '/opt/blender/blender', '/usr/bin/blender'].find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Blender not found: set BLENDER to blender(.exe)');
  return found;
}
