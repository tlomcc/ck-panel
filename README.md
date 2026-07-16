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

Chat rendering is optimistic: the visible user bubble and assistant typing placeholder appear before route discovery and network response, but the request body is still assembled from the same pending-message snapshot. System prompt and active worldbook editor values are reread before every request. `nc_context_injection` controls only current-time context, while `recall` independently controls memory lookup and injection. Dynamic blocks remain after stable cache anchors and never carry `cache_control`. Cache strategy is also persisted under a dedicated small local-storage key so large worldbook/config writes cannot silently reset it.

The send-button hot path is intentionally small. It changes the button state and snapshots/clears the composer first, yields a browser paint, then performs message aggregation, route lookup and request construction. Pending-to-user transitions replace only the affected message rows. Full session serialization and session-list rendering are coalesced into an idle callback, except when auto-trim requires a structural full-list rebuild.
