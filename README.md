# Hawkes Assets

The shared 3D cast for Hawkes Biomedical projects: rigged characters, animations, props, sets and skies. Any project,
and the cloud (Hawkes Gen's `blender.render`, Hawkes Studio), uses the same files.

The models live in S3 and git keeps what they are (`assets.lock.json`). After cloning:

```bash
npm install
node tools/sync.mjs pull
```

Adding and uploading files: [`AGENTS.md`](AGENTS.md).

## What's here

| | Count |
|---|---|
| Characters | 10: PH Origins' cast (8, Mixamo rigs), Breaking Through's hero (Biped rig), Yooba |
| Animations | 29 Mixamo clips (walk, run, idle, punch, kick, sit and talk, pistol moves, falls...), 23 Biped clips (Breaking Through's hero: idles, jog, run, punches, kicks) |
