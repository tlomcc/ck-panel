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

Do not add ad-hoc `messages` or `history` fields to `/ck/chat`. Normal turns reuse the gateway-returned `transport_messages`, with `window_messages` as the defined same-window fallback. Regeneration clears stale transport and sends the visible window through `window_messages` after removing the assistant reply being regenerated; `text` remains the current reply target.

Chat rendering is optimistic: the visible user bubble and assistant typing placeholder appear before route discovery and network response, but the request body is still assembled from the same pending-message snapshot. System prompt and active worldbook editor values are reread before every request. `nc_context_injection` enables the gateway-owned current-time and recall block; that block must remain after a stable cache anchor and must never carry `cache_control`.
