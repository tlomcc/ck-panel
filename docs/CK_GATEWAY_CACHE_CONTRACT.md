# CK Gateway Cache Contract

This contract protects prompt cache hits between CK panel and CK gateway.

## Request Body

`/ck/chat` should send the current turn and stable configuration only:

```json
{
  "key": "panel key",
  "session_id": "window session id",
  "text": "current user text",
  "model": "model name",
  "system": "stable system prompt",
  "worldbook_pack": "stable worldbook text",
  "worldbook_injection_position": "system_tail",
  "api_base": "upstream base URL",
  "upstream_key": "upstream key",
  "recall": true,
  "ck_thinking_enabled": false,
  "ck_thinking_prompt": "visible pseudo-thinking style prompt",
  "ck_thinking_injection_position": "system_after_anchor",
  "use_mcp": false,
  "cache_strategy": "single_5m | prefix_24h | assistant_latest",
  "prompt_cache_ttl": "5m for strict breakpoint modes only; omit for prefix_24h",
  "session_anchor": {
    "first_user_text": "first visible user message in this CK window",
    "first_user_ts": 1760000000000
  },
  "transport_messages": "hidden exact upstream history returned by the gateway"
}
```

Do not send these fields:

- `history`
- `messages`
- `outboundHistory`
- `clientHistory`
- `conversation`
- `conversationHistory`

`script.js` has a request-body lock that removes those fields before sending, but new code should not add them in the first place.

`prompt_cache_ttl` is the upstream prompt-cache lifetime, not the amount of chat history sent. The CK panel derives it from `cache_strategy`: `single_5m` sends `5m`; `assistant_latest` sends `5m`; `prefix_24h` omits `prompt_cache_ttl` and does not request explicit Anthropic-style `cache_control`. The panel still sends the full same-window history through `transport_messages`/`window_messages`; history cleanup is controlled by `recall_history_retention_seconds`.

`recall` controls only gateway memory recall. `true` means the gateway may query memory and inject a `<ck_gateway_context>` block when recall returns content. `false` still routes through the gateway, but must not query memory, must not inject `<ck_gateway_context>`, and should strip old gateway recall blocks from hidden history so stale recall does not leak into the no-recall mode.

The gateway must not inject a changing current-time block just because recall is enabled. If memory recall returns no content, the gateway should skip `<ck_gateway_context>` entirely. Dynamic recall, if present, must stay after a stable user cache anchor and must not itself carry `cache_control`.

`transport_messages` is the exception: it is not display history. It is the gateway-returned hidden upstream transport history and must be sent back unchanged on the next turn for serverless instance switches and cold starts. The panel should omit this field when it has no hidden transport yet, and the gateway should ignore empty transport arrays so `window_messages` or gateway session history can still be used.

Regeneration is the explicit exception to transport reuse. The panel removes the assistant reply being regenerated, clears the now-stale hidden transport, and sends the complete remaining visible user/assistant list in `window_messages`. The latest user also remains in `text` as the reply target; the gateway's existing current-user-tail deduplication prevents that user turn from being appended twice.

The gateway should send hidden history through a dedicated `transport` SSE event:

```json
{
  "messages": [],
  "count": 0,
  "bytes": 0
}
```

The `done` event should only include `transport_messages_count` and `transport_messages_bytes` for diagnostics. The panel must not store full transport payloads in debug records.

The gateway should include `cache_fingerprint` in cache debug events. It is a small diagnostic object with:

- `request_hash`
- `request_bytes`
- `system_hash`
- `tools_hash`
- `breakpoint_summary`
- `breakpoints[].prefix_bytes`
- `breakpoints[].prefix_token_estimate`
- `compare_previous.status`: `first`, `same`, `partial`, or `changed`
- `compare_previous.changes`
- `compare_previous.stable_matches`

The panel displays this so cache misses can be traced to a changed system/tools block, a cache breakpoint prefix change, or a first-turn prefix that is too small to be useful for upstream prompt cache.

When the gateway performs multiple upstream rounds for tools, the final `usage` and `done.usage` should be the aggregate across all upstream rounds. `done.last_usage` may contain the final upstream round, and `done.round_usages` may contain per-round diagnostics. The panel should use aggregate usage to mark a user message as cache-hit, so a tiny final tool-followup request does not make the whole message look like a prompt-cache miss.

For `/ck/chat`, the gateway may append a transient `<ck_reply_target>` text block to the latest real user message in the upstream request copy. This block repeats the current user text and tells the model to answer only the latest message; it must not be written back into `transport_messages` or visible history.

`session_anchor` is also allowed. It is a small stable anchor for the window's first user message, used so the model can still answer questions about the start of the window after recent-history trimming.

`cache_strategy` is allowed and should be one of:

- `single_5m`: place the cache breakpoint under the latest user message. It is strict: the cached prefix must match byte-for-byte within the 5 minute TTL. The gateway preserves injected historical user messages while the previous turn is still within the short prompt-cache TTL; when idle time exceeds `recall_history_retention_seconds`, it strips old `<ck_gateway_context>` blocks and rebuilds from clean chat history.
- `prefix_24h`: optimize for NC long-lived common-content cache. The gateway strips old `<ck_gateway_context>` blocks every turn, keeps clean chat history as the stable prefix, and only injects recall into the current user message. This mode must not add explicit `cache_control` anchors and must not send `prompt_cache_ttl: "1h"`; the strategy name describes NC's common-content cache behavior, not a one-hour history window.
- `assistant_latest`: place the cache breakpoint after the latest assistant message. Editing/deleting the latest assistant reply or inserting a message after it can invalidate that breakpoint.

`recall_history_retention_seconds` defaults to `300` for `single_5m` and `assistant_latest`, and `0` for `prefix_24h`. The gateway should report `idle_seconds`, `strip_old_recall`, `stripped_gateway_context_messages`, and `stripped_gateway_context_chars` in `meta`.

`ck_thinking_enabled` and `ck_thinking_prompt` are optional CK pseudo-thinking controls. When enabled, the gateway injects a stable system block that asks the model to put a short visible inner-monologue block before the normal reply:

```xml
<ck_thinking>
...
</ck_thinking>
```

This is not upstream hidden chain-of-thought. It is user-visible role text that the panel folds under "思考" and keeps in visible/transport history, so later turns can quote or remember it. Changing the prompt changes the system prefix and can invalidate prompt-cache hits.

`worldbook_injection_position`, `ck_thinking_injection_position`, and `memory_pack_injection_position` may use these values:

- `system_after_main`: as a system block immediately after the main system prompt.
- `system_after_anchor`: as a system block after the CK session anchor.
- `system_tail`: as the last stable system block.
- `latest_user_prefix`: prepended to the latest real user message.
- `latest_user_suffix`: appended to the latest real user message.

Defaults preserve current CK behavior: pseudo-thinking uses `system_after_anchor`; worldbook and memory pack use `system_tail`. Use `latest_user_*` only for compatibility testing, because those positions sit near the dynamic recall context and usually give weaker prompt-cache reuse than stable system positions.

`use_mcp` and `mcp_url` are optional and must default to disabled. Enabling MCP adds tool schemas to the upstream request and may change prompt-cache prefixes. Keep MCP off for normal cache-hit testing; turn it on only when the user explicitly wants tool access. The gateway sorts external MCP tools by name and caches `tools/list` results so transient MCP errors do not flip the upstream tools prefix from populated to empty.

For the Claude-compatible `/v1/messages` gateway route used by RikkaHub, prompt-cache-off traffic must be a near pass-through: default to no memory recall injection, do not add current time, do not add gateway-owned `cache_control` when the client did not send one, and keep forwarding headers limited to stable AI-provider headers. If RikkaHub-compatible recall is explicitly enabled by key/header/body, the gateway must freeze and restore old injected user messages before adding the latest recall block; otherwise a serverless instance switch can make the next turn's prefix differ from the previous turn. If the client did send `cache_control`, the gateway may strip and relocate anchors away from dynamic `<ck_gateway_context>` blocks, but it must not invent anchors for RikkaHub promptCaching=false requests. This matches RikkaHub direct-to-NC behavior, where promptCaching=false sends no explicit message `cache_control` but NC can still reuse stable common prefixes.

`window_messages` is the dedicated same-window full-context field. It is different from forbidden `history` / `messages`:

- the panel sends only the currently selected CK window's visible user/assistant messages;
- the panel must build `window_messages` before converting the current pending user input into persisted `user` messages, so the current turn is carried only by `text`;
- the gateway treats it as `client_window:*`, not generic `client_history`;
- the latest user message, including a tail of consecutive staged user messages joined by blank lines, is de-duplicated against `text`;
- the gateway can still apply canonical injection to restore frozen old user messages.

This mode matches CK window semantics: staying in the same window keeps forwarding that window's full context; creating or selecting another window uses another session/history.

## Local Session Storage

The CK panel stores full chat windows in IndexedDB:

- database: `ckPanelChatStoreV1`
- object store: `sessions`
- full visible messages are kept when `CHAT_MAX_VISIBLE_MESSAGES = 0`
- full hidden transport history is kept when `CHAT_MAX_TRANSPORT_MESSAGES = 0`

`localStorage` key `ckChatSessionsV2` is now only a small compatibility summary. It is used for fast startup and fallback, but the full same-window history should come from IndexedDB. Existing `ckChatSessionsV2` data is migrated into IndexedDB when the chat page opens.

For a PWA/mobile install, the data is still local device data owned by this site/app. Clearing site data, uninstalling the PWA, or switching browser/device can remove it unless a server-side sync layer is added later.

## Window Semantics

- A panel chat window maps to one `session_id`.
- Creating a new chat window creates a new `session_id`.
- Selecting an old window restores its old `session_id`.
- Browser tab duplication may reuse local storage and therefore may reuse the active `session_id`.

## Gateway Ownership

The gateway owns:

- chat history used for upstream requests
- recall injection
- injected-history freezing
- cache anchor placement
- prompt cache continuity

The panel owns:

- local display messages
- hidden `transport_messages` returned by the gateway
- stable `session_anchor` for the first user message in the window
- window list UI
- stable config fields
- current user text
- debug records, with large transport/memory payloads stripped before localStorage writes

For full same-window behavior, configure the gateway with:

```env
CK_CHAT_MAX_MESSAGES=0
CK_WINDOW_MAX_MESSAGES=0
```

`CK_CHAT_MAX_MESSAGES` controls gateway session and hidden transport history. `CK_WINDOW_MAX_MESSAGES` controls visible `window_messages` accepted from the panel. `0` means do not truncate by message count; upstream context limits and request size still apply.

## Expected Cache Behavior

- First turn in a new window may create cache.
- Later turns in the same window should read the previous turn's cache, as long as TTL is valid and the panel returns the gateway's `transport_messages`.
- A new window can still read cached `system` or `worldbook` prefixes if they are identical to another window. That does not mean chat history leaked.

## Verification Checklist

Use gateway debug records to check:

- `history_source` stays `gateway_session`.
- With client transport enabled, `history_source` may be `client_transport:transport_messages`.
- `history_messages` is `0` on the first turn of a new panel window.
- `client_history_ignored` is absent or false during normal requests.
- `cache_read_input_tokens` appears from the second or later turn, subject to upstream TTL.
- If the second turn misses but the third turn hits, inspect `breakpoints[].prefix_bytes`; the first turn may not have had enough stable prefix to create a reusable upstream prompt cache entry.
