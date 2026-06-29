# ck-panel

Static CK panel for the memory and CK gateway stack.

## Runtime Files

- `index.html`: page shell and static asset version wiring.
- `script.js`: main app logic, including the CK chat request path.
- `script-extra.js`: small auxiliary browser behavior.
- `style.css`, `chat.css`, `polish.css`: visual styles.
- `pwa.js`, `sw.js`, `manifest.webmanifest`: PWA and service worker wiring.
- `icons/`: app icons referenced by the manifest and service worker.

These files stay at the repository root because `index.html`, `sw.js`, and the deployed static host reference them directly.

## Docs

- `docs/REPOSITORY_STRUCTURE.md`: repository map and safe-change boundaries.
- `docs/CK_GATEWAY_CACHE_CONTRACT.md`: rules that protect CK gateway prompt cache hits.

## Cache Safety

Do not add local chat history to the `/ck/chat` request body. The gateway owns chat history, recall injection, and cache anchors. The panel should send only the current user text plus stable config fields.
