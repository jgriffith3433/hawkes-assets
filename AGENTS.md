# Hawkes Assets — agent guide

The shared 3D library for every Hawkes Biomedical project. It holds characters (rigged models), animations, props,
sets (whole scenes) and skies, so the cloud (Hawkes Gen's `blender.render`, Hawkes Studio, agents) can use the same
cast as J's PC. Owner: **J**. `CLAUDE.md` imports this file; edit this one.

**The files themselves live in S3, not git.** Git keeps what they are:
- each entry's `.json`
- `assets.lock.json`: every file's path, SHA-256 and size

The files are stored by content in `s3://hawkes-assets-028793236279/sha256/<hash>` (private, us-east-1).
`.gitignore` keeps every model, image and video out of git.

## Use

```bash
npm install
node tools/sync.mjs pull             # download every file in the lock (or what changed)
node tools/sync.mjs status --remote  # what's missing here, changed here, or not in S3
node tools/add.mjs character my-hero path/to/model.glb --project phorigins --name "My hero" --reference sheet.png
node tools/add.mjs animation path/to/Mixamo/Walking.fbx            # rig family found by Blender; id from the name
node tools/add.mjs prop|set|sky <id> <file>
node tools/sync.mjs push             # upload new files (records them in the lock first)
node tools/check.mjs                 # every .json valid, every file it names in the lock (CI runs this)
```

`add.mjs` opens each file in Blender (`tools/inspect.py`; `BLENDER` or the usual install paths). It records the rig
family, the animations inside, the height and where the file came from (`source`). **Commit after `push`:** the
commit is what everyone else pulls. Pushing to S3 costs cents. Ask J before adding gigabytes.

## Layout

| Path | What |
|---|---|
| `characters/<id>/` | `character.json` + `model.glb/.fbx/.blend` (+ `reference.png`, the character sheet) |
| `animations/<rig>/<id>.fbx` + `.json` | Clips by rig family: `mixamo`, `biped` (3ds Max), `humanoid`, `rigify`, `custom` |
| `props/<id>/` | `prop.json` + `model.*` |
| `sets/<id>/` | `set.json` + `scene.blend/.glb` (a whole location) |
| `skies/<id>.png/.hdr` + `.json` | Equirect panoramas (e.g. from Hawkes Gen's `image.panorama`) |

`character.json`:

| Field | What |
|---|---|
| `id`, `name`, `projects` | Who it is and which projects use it |
| `model` | The model file in the folder |
| `reference` | The character sheet, or null |
| `rig` | The rig family. Animations of the same family play on it: Mixamo clips on any Mixamo rig, whatever the bone prefix |
| `height` | Meters, measured on the rig's meshes |
| `facing` | Degrees; 0 faces -Y, Blender's front view |
| `animations` | The clips inside the model file |
| `look` | Canon look, in words, for prompts |
| `source` | Where it came from, relative to `C:\Projects` |

Ids are lowercase words and dashes, prefixed by project where it helps (`ph-ch33-hero`, `bt-hero`).

## Rules

- **Never commit a model or image.** If `git status` shows one, `.gitignore` is missing its extension: add the
  extension there and in `tools/lib.mjs` (`BINARY`).
- **Replacing a file** (a fixed rig, a new texture) is just add again + push + commit. The old version stays in S3
  under its hash, so older commits still pull.
- **Rig families matter.** A Biped clip won't play on a Mixamo rig. Use the character's own family, or retarget in
  Blender first.
- The source projects keep their own copies for their games. This library is the shared cast for video and the
  cloud, not where games load from.
