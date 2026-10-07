# The `/upload` folder — a scratch inbox for raw assets

The repo's `upload/` folder is a temporary drop zone. The user puts raw resources there (images, fonts, Dextrous layout exports, zips) for a task to consume. It is NOT a permanent home for anything.

When a task uses a file from `upload/`:

1. **Document what was used and where it went.** In the task's final summary, list every consumed file as `upload/<name> -> <final repo path>` (e.g. `upload/spd1.png -> assets/cards/bo-sieu-phan-ong-cap-1.png`). If a file was transformed rather than copied verbatim (cut out, baked, extracted from a zip), name both the source and the derived artifact(s).
2. **Move/bake it to its correct final location** in the repo (e.g. `assets/cards/`, `assets/frames/<faction>/source/`, `assets/fonts/`). Confirm it is actually in place.
3. **Then delete it from `upload/`.** Only after the file is confirmed placed/verified. Delete every consumed file, including archives (`.zip`) once their contents are extracted to the right place.

Never leave consumed files lingering in `upload/`, and never delete an upload file before its final destination is confirmed. If a task finishes without using a file that was in `upload/`, leave that file alone (it may be for a later task) and note it was unused.
