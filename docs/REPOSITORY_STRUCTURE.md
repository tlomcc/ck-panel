# Repository Structure

The panel is a static app. Root-level runtime files are intentional because the service worker and static host address them by relative path.

## Root Runtime Files

- `index.html` loads the app shell and pins static asset versions such as `chat-v28`.
- `script.js` contains the main app behavior and the `/ck/chat` request builder.
- `script-extra.js` contains small auxiliary UI behavior.
- `style.css`, `chat.css`, and `polish.css` are loaded directly by `index.html`.
- `pwa.js` registers the service worker.
- `sw.js` precaches the shell assets.
- `manifest.webmanifest` and `icons/` support installable app behavior.

## Documentation

- `README.md` is the short entry point.
- `docs/REPOSITORY_STRUCTURE.md` explains why runtime files are not moved into subfolders.
- `docs/CK_GATEWAY_CACHE_CONTRACT.md` documents the cache-sensitive chat request contract.

## Safe Organization Rules

- Do not move root runtime files unless `index.html`, `sw.js`, and deployment hosting paths are updated together.
- Do not bump `chat-vXX` for documentation-only changes.
- Do not change the `/ck/chat` request body unless the gateway cache contract is revalidated.
- Keep diagnostic pages or notes under `docs/` or another non-runtime path so they cannot alter the chat flow.
