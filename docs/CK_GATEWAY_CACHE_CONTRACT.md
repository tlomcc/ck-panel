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
  "use_mcp": false
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
- window list UI
- stable config fields
- current user text

## Expected Cache Behavior

- First turn in a new window may create cache.
- Later turns in the same window should read the previous turn's cache, as long as TTL and gateway state are available.
- A new window can still read cached `system` or `worldbook` prefixes if they are identical to another window. That does not mean chat history leaked.

## Verification Checklist

Use gateway debug records to check:

- `history_source` stays `gateway_session`.
- `history_messages` is `0` on the first turn of a new panel window.
- `client_history_ignored` is absent or false during normal requests.
- `cache_read_input_tokens` appears from the second or later turn, subject to upstream TTL.
