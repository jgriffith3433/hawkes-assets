# Hawkes Assets

The shared cast and art for Hawkes Biomedical projects: rigged characters, animations, props, sets and skies, plus the 2D art folders (DoD's characters and maps, Sick Of It's art). Any project,
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
| 2D art (tracked in place, `mounts.json`) | DoD's `AllTheCharacters` (34 characters: poses, animation clips, pose data) and `AllTheMaps`; Sick Of It's enemies, images, objects, player and videos: 6,255 files, 1.66 GB unique |
| Animations | 29 Mixamo clips (walk, run, idle, punch, kick, sit and talk, pistol moves, falls...), 23 Biped clips (Breaking Through's hero: idles, jog, run, punches, kicks) |
