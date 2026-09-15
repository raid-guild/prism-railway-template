# Codex Runtime Image Generation Version Pin

## Summary

`services/codex-runtime` pins `@openai/codex` to `0.144.6`.

The runtime previously stayed on `0.139.0` because Codex CLI `0.140.0` and
`0.141.0` had a regression in the built-in `image_gen` path when run through
`codex exec`. OpenAI fixed that persistence bug in `openai/codex#28656`; the
issue reporter verified the fix in `0.142.0`, and Prism reproduced the fixed
headless behavior on `0.144.6` before upgrading.

The runtime still enables image generation with:

```bash
--enable image_generation
```

The exact pin is not a feature toggle. It keeps Railway rebuilds reproducible
and ensures Codex CLI upgrades receive an explicit image-artifact smoke test.

## Historical Regression

On June 17, 2026, a local test with `codex-cli 0.140.0` reproduced this behavior:

- `codex exec --json --enable image_generation` could call built-in `image_gen`.
- The generated image appeared inline to the session.
- No new file appeared in the working directory.
- No new file appeared under `$CODEX_HOME/generated_images`.
- No usable image path appeared in the session JSONL.

That means Prism Console could receive text saying an image was generated, while codex-runtime had no file path or bytes to upload as a request artifact.

The same machine still had older generated images under:

```text
$CODEX_HOME/generated_images
```

from interactive/non-`exec` Codex sessions, so this was specific to the headless `codex exec` path.

## Public Reports

Two public `openai/codex` issues documented this behavior:

- `openai/codex#28526`: built-in `image_gen` succeeds in CLI but never writes the PNG to disk.
- `openai/codex#28422`: regression in `0.140.0`; valid base64 PNG is present, but no file is written, and rolling back to `0.139.0` restores image saving.

OpenAI merged `openai/codex#28656` on June 17, 2026. The change persists a
built-in image result whenever image data is present, even when the terminal
item status remains `generating`. The `#28422` reporter confirmed the repair in
`0.142.0` and closed the issue as completed.

On July 21, 2026, Prism tested `0.144.6` in an isolated `CODEX_HOME` on the
production Linux runtime using the headless command below. The command exited
successfully and produced the same valid 793,503-byte PNG in both:

```text
$CODEX_HOME/generated_images/<thread-id>/<call-id>.png
<workspace>/generated.png
```

Official Codex imagegen skill guidance still expects built-in image generation outputs to be available under `$CODEX_HOME/generated_images/...` so agents can copy project-bound assets into the workspace.

## Why Deployment Uses npm ci

The codex-runtime Dockerfile must install from `package-lock.json`.

Do not switch it back to a loose `npm install` from `package.json` only. A floating install can silently pick up a newer Codex CLI on Railway rebuilds, which makes image behavior change without a code diff.

## Validation For Future Upgrades

Before upgrading `@openai/codex`, verify all of the following inside a
codex-runtime-like environment:

```bash
tmpdir=$(mktemp -d /tmp/codex-imagegen-test-XXXXXX)
codex --version
codex exec --json \
  --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox \
  --enable image_generation \
  -o "$tmpdir/out.txt" \
  -C "$tmpdir" \
  'Use only the built-in image_gen tool to generate a small image. Do not create it with SVG, canvas, PIL, ImageMagick, or manual code. Save the generated bitmap as generated.png in the current directory and report the path.'

find "$tmpdir" "$CODEX_HOME/generated_images" -type f \
  \( -iname '*.png' -o -iname '*.webp' -o -iname '*.jpg' -o -iname '*.jpeg' \) \
  -mmin -10 -print
```

The test passes only if the built-in image generation output is available as a real image file that codex-runtime can copy or upload.

## Prism Follow-Up

Even after the upstream CLI behavior is fixed, Prism should eventually add explicit artifact plumbing for image workflows:

- detect generated image files from a run,
- copy the selected output into a stable runtime path,
- upload it to `POST /agent/change-board/requests/:id/artifacts` with `encoding: "base64"`,
- show it in the request Artifacts tab.

Until then, image generation in Prism Console should be treated as best-effort unless the workflow confirms a saved file path.
