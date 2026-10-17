// Keeps the library's files and S3 in step. Git holds what the files are (assets.lock.json: path -> sha256, size);
// S3 holds the files, stored by content (s3://hawkes-assets-028793236279/sha256/<hash>, private).
//
//   node tools/sync.mjs status [--remote]   what's missing here, changed, not in the lock (and, with --remote, not in S3)
//   node tools/sync.mjs lock [--prune]      record the files here in the lock (--prune drops entries whose file is gone)
//   node tools/sync.mjs push                lock, then upload what S3 doesn't have yet (creates the bucket the first time)
//   node tools/sync.mjs pull                download what's missing or different here
//
// After push, commit assets.lock.json (and the .json files): that commit is what everyone else pulls.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, BUCKET, readLock, writeLock, sha256, binaries, abs, s3, keyOf } from './lib.mjs';

const [cmd = 'status', ...flags] = process.argv.slice(2);
const has = (f) => flags.includes(f);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** Runs work over items, n at a time. */
async function pool(items, n, work) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await work(items[i++]);
  }));
}

async function lock({ prune = false } = {}) {
  const l = readLock();
  const changes = [];
  for (const r of binaries()) {
    const st = fs.statSync(abs(r));
    const cur = l[r];
    // Same size: hash only if it was touched after the lock was written.
    const sha = await sha256(abs(r));
    if (!cur || cur.sha256 !== sha) {
      changes.push(`${cur ? 'changed' : 'added'}  ${r} (${mb(st.size)})`);
      l[r] = { sha256: sha, size: st.size };
    }
  }
  if (prune) for (const r of Object.keys(l)) if (!fs.existsSync(abs(r))) { delete l[r]; changes.push(`removed  ${r}`); }
  writeLock(l);
  return changes;
}

async function inS3(sha) {
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  try {
    await (await s3()).send(new HeadObjectCommand({ Bucket: BUCKET, Key: keyOf(sha) }));
    return true;
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false;
    throw e;
  }
}

async function ensureBucket() {
  const S = await import('@aws-sdk/client-s3');
  const c = await s3();
  try {
    await c.send(new S.HeadBucketCommand({ Bucket: BUCKET }));
    return;
  } catch (e) {
    if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== 'NotFound') throw e;
  }
  await c.send(new S.CreateBucketCommand({ Bucket: BUCKET, ObjectOwnership: 'BucketOwnerEnforced' }));
  await c.send(new S.PutPublicAccessBlockCommand({ Bucket: BUCKET, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
  console.log(`created the private bucket ${BUCKET}`);
}

async function push() {
  summary(await lock());
  await ensureBucket();
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const l = readLock();
  // One upload per distinct file (the same file in two places is stored once).
  const unique = new Map();
  for (const [r, e] of Object.entries(l)) if (!unique.has(e.sha256) && fs.existsSync(abs(r))) unique.set(e.sha256, [r, e]);
  let sent = 0;
  let bytes = 0;
  await pool([...unique.values()], 8, async ([r, e]) => {
    if (await inS3(e.sha256)) return;
    // S3 metadata is ASCII only.
    await (await s3()).send(new PutObjectCommand({ Bucket: BUCKET, Key: keyOf(e.sha256), Body: fs.createReadStream(abs(r)), ContentLength: e.size, Metadata: { path: encodeURIComponent(r).slice(0, 1500) } }));
    sent++;
    bytes += e.size;
    if (sent % 100 === 0 || e.size > 20 * 1048576) console.log(`uploaded ${sent} (${mb(bytes)}), last ${r}`);
  });
  console.log(`${sent} file(s) uploaded (${mb(bytes)}); S3 has all ${unique.size}. Commit assets.lock.json.`);
}

async function pull() {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const l = readLock();
  let got = 0;
  for (const [r, e] of Object.entries(l)) {
    const f = abs(r);
    if (fs.existsSync(f) && fs.statSync(f).size === e.size && (await sha256(f)) === e.sha256) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const res = await (await s3()).send(new GetObjectCommand({ Bucket: BUCKET, Key: keyOf(e.sha256) }));
    const tmp = `${f}.part`;
    await new Promise((resolve, reject) => res.Body.pipe(fs.createWriteStream(tmp)).on('finish', resolve).on('error', reject));
    if ((await sha256(tmp)) !== e.sha256) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`${r}: the download doesn't match the lock`);
    }
    fs.renameSync(tmp, f);
    got++;
    console.log(`downloaded ${r} (${mb(e.size)})`);
  }
  console.log(`${got} file(s) downloaded; ${Object.keys(l).length} in the library.`);
}

async function status() {
  const l = readLock();
  const local = new Set(binaries());
  const missing = Object.keys(l).filter((r) => !local.has(r));
  const untracked = [...local].filter((r) => !l[r]);
  const changed = [];
  for (const r of [...local].filter((x) => l[x])) if ((await sha256(abs(r))) !== l[r].sha256) changed.push(r);
  console.log(`${Object.keys(l).length} files in the lock (${mb(Object.values(l).reduce((s, e) => s + e.size, 0))})`);
  for (const [label, list] of [['not here (pull)', missing], ['changed here (push)', changed], ['not in the lock (push)', untracked]]) {
    if (list.length) console.log(`${label}:\n  ${list.join('\n  ')}`);
  }
  if (has('--remote')) {
    const absent = [];
    await pool(Object.entries(l), 16, async ([r, e]) => { if (!(await inS3(e.sha256))) absent.push(r); });
    console.log(absent.length ? `not in S3 (push from where they are):\n  ${absent.join('\n  ')}` : 'S3 has every file in the lock.');
  }
}

const summary = (changes) => {
  for (const c of changes.slice(0, 40)) console.log(c);
  if (changes.length > 40) console.log(`... and ${changes.length - 40} more`);
};
const run = { status, push, pull, lock: async () => summary(await lock({ prune: has('--prune') })) }[cmd];
if (!run) {
  console.error('usage: node tools/sync.mjs status [--remote] | lock [--prune] | push | pull');
  process.exit(2);
}
process.chdir(ROOT);
run().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
