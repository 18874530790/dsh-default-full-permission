# dsh-default-full-permission

Makes **new and existing** DSH sessions resolve to the `danger-full-access`
permission preset: full file access, no approval prompts.

> **This is a security downgrade, and that is the entire point.**
> After installing, DSH will write anywhere and stop asking for confirmation —
> for every session, including ones that already chose a stricter preset. Only
> install it on a machine and profile where you have decided that is what you
> want. `## Reverting` below tells you how to undo it.

## Why three layers are needed

DSH resolves a session's effective permission as

```
effective = request override ?? session override ?? deployment default
```

A session override outranks the deployment default, so **none of the three
layers alone covers both halves of the requirement**:

| Layer                                     | Covers                                |
| ----------------------------------------- | ------------------------------------- |
| `sandbox-policy` config `mode`            | sessions with no override             |
| `approval` config `policy`                | sessions with no override             |
| `permission` config `defaultPreset`       | the first three events of a NEW session |
| this plugin + `scripts/`                  | sessions that already pinned a value  |

`pinInitialPermission` reads `defaultPreset` and writes the preset's knobs as a
fresh session's `permission/preset`, `sandbox/mode` and `approval/policy` events
at seq 0-2. That is why `defaultPreset` matters even though the plugin also
corrects sessions: a new session starts correct instead of being corrected.

Every session that already exists has pinned its own values, so the deployment
default does not reach it. That is what the plugin and the scripts handle.

## Profile configuration

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: danger-full-access
- id: approval
  name: "@deepseek-ai/dsh-user-approval"
  config:
    policy: never
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    defaultPreset: danger-full-access
```

`defaultPreset` is a `.volatile()` field: the schema wraps it in a reference
object exposing `.get()`. The plugin reads `config.defaultPreset.get()`, so the
patch value is what a runtime sees until the settings UI writes a newer one.

## Runtime half (the plugin)

`lib/index.js` waits for `permissionPresets`, `approval` and `agents`, then:

1. registers an `agent/created` listener — no `prepend`, so it runs **after** the
   built-in `pinInitialPermission` and is the last word on a fresh session;
2. sweeps `agents.list()` once, covering resumed sessions and a restart with
   live sessions restored;
3. appends only the knobs that differ from the target, so it is idempotent and
   a restart does not grow the log.

## Offline half (the scripts)

`scripts/patch-sessions.cjs` and `scripts/sync-projection-cache.cjs` fix sessions
that are not live, without waiting for the app to reload:

```bash
node scripts/patch-sessions.cjs --dry-run         # preview, writes nothing
node scripts/sync-projection-cache.cjs --dry-run  # preview, writes nothing

# after quitting DSH fully (Ctrl+Q, not the window ×)
node scripts/patch-sessions.cjs                   # append the override events
node scripts/sync-projection-cache.cjs            # move the UI projection cache forward
```

### Running the scripts safely

Both scripts rewrite files the running app has open, so `scripts/_guard.cjs`
gates them:

| Condition                          | Behaviour                          |
| ---------------------------------- | ---------------------------------- |
| DSH running, no flags              | refuses, exit **2**                |
| DSH running, `--dry-run`           | allowed — read-only, prints `[dry]` |
| DSH running, `--force`             | allowed — the escape hatch          |
| session directory missing          | refuses, exit **3**                 |

`--dry-run` and `--force` are not the same escape. `--dry-run` never writes, so
it is safe at any time and is how you should preview. `--force` writes anyway —
use it only when you have quit the app and a stale process entry is the only
thing left, because writing a live session can desynchronise it.

Set `DSH_HOME` when your DSH data directory is not `~/.dsh`; a wrong path now
fails with exit 3 instead of silently patching zero sessions.

A session log is a **sequence of independent zstd frames**, not one stream.
`zlib.zstdDecompressSync` decodes only the first frame, so both scripts split on
the frame magic `28 b5 2f fd` and decompress each frame separately. The patch
appends new frames rather than rewriting the file, so existing bytes stay
identical and the sequence numbers continue from the last event.

`sync-projection-cache.cjs` matters because the UI reads
`~/.dsh/storages/session_projcache/`. Each projection row there carries a `seq`
watermark. A row whose watermark is behind the log is replayed by the runtime,
but until that happens it shows the old values — so the script rewrites
`permissions`, `sandboxMode` and `approvalState` to the target values with the
new watermark.

Safe to re-run: both scripts skip anything already on the target.

## Target values

| Knob       | Value                |
| ---------- | -------------------- |
| preset     | `danger-full-access` |
| sandbox    | `danger-full-access` |
| approval   | `never`              |

Constants at the top of `lib/index.js` and both scripts.

## Install

### From GitHub

```bash
plugin_manager install_bundle target="github:18874530790/dsh-default-full-permission#v1.0.1"
```

### From a local checkout

The profile links the package and loads its bundle patch:

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": { "dsh-default-full-permission": "link:/absolute/path/to/dsh-default-full-permission" },
  "dsh": { "profile": { "bundles": [ /* …, */ "dsh-default-full-permission" ] } }
}
```

Then `pnpm install` in the profile directory — a hand-made symlink fails on
Windows with `Operation not permitted`.

## Verifying

Start a new session and send `/permission`. It should report:

```
current preset danger-full-access
```

To check an existing session's log directly, remember it is a frame sequence:
decompress each zstd frame separately (see above), then look for
`permission/preset`, `sandbox/mode` and `approval/policy`.

## Reverting

Remove the bundle row, the three config layers and the `insert:` entry, then
restart. Sessions already pinned keep `danger-full-access`; switch any back with
`/permission workspace-write`.
