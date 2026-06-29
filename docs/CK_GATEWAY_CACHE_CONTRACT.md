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
  "api_base": "upstream base URL",
  "upstream_key": "upstream key",
  "recall": true,
  "use_mcp": false,
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

`transport_messages` is the exception: it is not display history. It is the gateway-returned hidden upstream transport history and must be sent back unchanged on the next turn for serverless instance switches and cold starts. The panel should omit this field when it has no hidden transport yet, and the gateway should ignore empty transport arrays so `window_messages` or gateway session history can still be used.

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
- `compare_previous.status`: `first`, `same`, `partial`, or `changed`
- `compare_previous.changes`
- `compare_previous.stable_matches`

The panel displays this so cache misses can be traced to a changed system/tools block or cache breakpoint prefix instead of guessed from token counts.

`session_anchor` is also allowed. It is a small stable anchor for the window's first user message, used so the model can still answer questions about the start of the window after recent-history trimming.

`use_mcp` and `mcp_url` are optional and must default to disabled. Enabling MCP adds tool schemas to the upstream request and may change prompt-cache prefixes. Keep MCP off for normal cache-hit testing; turn it on only when the user explicitly wants tool access.

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
