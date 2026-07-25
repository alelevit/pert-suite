# CLAUDE.md

## Deployment

- For UI/frontend changes, commit and push directly to `main` — no feature branches or PRs needed.
- Production runs on **Railway**: https://pert-suite-production-484b.up.railway.app
  - The todo app is served at `/todo`, the PERT app at `/pert`.
  - Railway builds `build:all` (see `railway.toml`), so a frontend change needs a
    Railway deploy to go live — pushing to `main` alone is not proof it shipped.
  - Verify a deploy actually landed before reporting success; do not assume the
    push triggered one.
- `render.yaml` and `sync-to-render.sh` are leftovers from the earlier Render
  setup. Render is not the live target.
