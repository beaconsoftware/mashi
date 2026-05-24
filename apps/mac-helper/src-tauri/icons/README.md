# Icons

This directory is intentionally light. Before running `pnpm tauri build`
you need to drop in:

- `icon.png` — 1024×1024 RGBA app icon (Tauri converts this to .icns).
- `menubar-template.png` — 22×22 black-on-transparent template image for
  the menubar. macOS recolors template images automatically for light /
  dark menubars, so the source should be a flat silhouette.
- `menubar-template@2x.png` — 44×44 retina pair of the above.

Quick way to bootstrap real icons:

```bash
# After dropping in icon-1024.png:
pnpm tauri icon icon-1024.png
```

This generates the full set (`icon.png`, `icon.icns`, `Square*.png`,
`StoreLogo.png`) into this directory.

Real icons are a deferred follow-up for the first internal build; see the
top-level `README.md` "Deferred" section.
