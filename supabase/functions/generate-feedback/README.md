# generate-feedback

Supabase Edge Function (Deno) that turns the metrics of one attempt into neutral practice notes with a language model (FR-3.7.x, SDD 5.6). The provider is Google Gemini or xAI Grok, called through their OpenAI-compatible Chat Completions endpoints by `../_shared/llm.ts` (plain `fetch`, no SDK) and chosen only by Supabase secrets.

`POST { "attempt_id": "<uuid>", "regenerate"?: true }` with the user's JWT → the stored `feedback` row (`GenerateFeedbackResult` in `contract.ts`).

## What it does

1. Verifies the JWT and creates the Supabase client with the request's `Authorization` header, so every query runs under the caller's RLS. The service-role key is never used.
2. Requires an active account-level consent with scope `ai_metrics_only` (`AI_CONSENT_SCOPE`).
3. Loads the attempt's `attempt_metrics` row, and the metrics of up to 3 earlier attempts of the same session for comparison.
4. Builds the payload (`payload.ts`): metric id, value, unit, phases and confidence. For a phrase attempt (`../_shared/phrase.ts`): the six theme values with confidence and null reasons, an event summary, theme medians of up to 5 earlier sessions of the same phrase, camera view and dancer (loaded by `../_shared/phraseContext.ts`, owner-filtered under RLS) and the dancer's focus themes. No ids, labels, titles, notes, dates, file names, subject codes, keypoints, frames or video. An optional `language` in the request (e.g. `es`) asks for the notes in that language.
5. Returns the stored note when one exists for the same `input_hash` (SHA-256 of payload + prompt version + model id from `LLM_MODEL`), unless `regenerate` is set.
6. Allows 20 notes per user per hour, counted from the user's `feedback` rows.
7. Calls the model in `LLM_MODEL` with the system prompt in `prompt.ts` and the `FeedbackResponse` JSON schema as `response_format` (`json_schema`, strict); 30-second budget, one retry on a connection error, 429 or 5xx.
8. Checks `finish_reason` (a safety stop or refusal and a `length` cut-off are errors), validates the JSON (`validate.ts`, always, even in schema mode), inserts the `feedback` row and returns it.

## Files

| File | Purpose |
| --- | --- |
| `index.ts` | Deno entry: CORS, Supabase queries, the model call |
| `../_shared/llm.ts` | Provider-neutral Chat Completions client (shared with `mika-chat`), tested in `src/feedback/llm.test.ts` |
| `handler.ts` | The request flow with the database and the model injected |
| `contract.ts` | Types, constants and error copy shared with `src/feedback/client.ts` (no imports) |
| `payload.ts` | The metrics-only payload sent to the model |
| `prompt.ts` | `SYSTEM_PROMPT` and `PROMPT_VERSION` |
| `validate.ts` | Output JSON schema and validation of the model's answer |
| `hash.ts`, `rateLimit.ts`, `cors.ts` | Input hash, rate-limit decision, allowed origins |

Everything except `index.ts` is plain TypeScript and is tested with Vitest in `src/feedback/feedback.test.ts` (`npm test`). The `// @ts-ignore TS5097` comments above the relative imports are there because Deno needs the `.ts` extension and the app's `tsconfig.json`, which also checks those tests, does not allow it.

Change `PROMPT_VERSION` whenever the prompt text changes; it is stored with each note and is part of the cache key.

## Secrets

Set them yourself in your own terminal; never paste the key into a chat or a file in the repo. The same three secrets serve `mika-chat`. See `src/v2/README.md` ("AI provider") for the Gemini and Grok values.

```
npx supabase secrets set LLM_API_KEY=<key> LLM_BASE_URL=<base-url> LLM_MODEL=<model>
```

Optional:

- `LLM_PROVIDER`: label for the logs (defaults to `gemini` / `grok` from the base URL).
- `LLM_JSON_MODE=json_object`: if the provider rejects `response_format: json_schema`, asks for a JSON object instead and puts the schema in the instructions. The validator checks the answer either way.
- `LLM_REASONING_EFFORT`: sent as `reasoning_effort` (e.g. `low`) when set; not sent by default because not every model accepts it.
- `ALLOWED_ORIGINS`: comma-separated origins added to the defaults in `cors.ts` (dev server, GitHub Pages, Capacitor).

Without `LLM_API_KEY`, `LLM_BASE_URL` or `LLM_MODEL` (or with a rejected key) the function answers `500 not_configured`. Changing `LLM_MODEL` changes the cache key, so the next request writes a fresh note. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided by the platform. The key never goes in `.env.local` or in the client bundle.

## Deploy

```
npx supabase functions deploy generate-feedback --use-api
```

JWT verification stays on (the default): do not pass `--no-verify-jwt`.

## Test with curl

Get an access token for a test user (the publishable key is the one in `.env.local`):

```
curl -s "https://<project-ref>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <publishable-key>" -H "Content-Type: application/json" \
  -d '{"email":"<test-user-email>","password":"<password>"}'
```

Call the function with the `access_token` from that response and the id of an attempt that has metrics:

```
curl -i "https://<project-ref>.supabase.co/functions/v1/generate-feedback" \
  -H "Authorization: Bearer <access_token>" \
  -H "apikey: <publishable-key>" \
  -H "Content-Type: application/json" \
  -d '{"attempt_id":"<attempt-uuid>"}'
```

Expected: `200` with `"cached": false` the first time and `"cached": true` on a repeat. Add `"regenerate": true` to ask the model again.

Checks worth running once after the first deploy:

- No `Authorization` header → `401`.
- A user without the `ai_metrics_only` consent → `403 consent_required`.
- Another user's attempt id → `404 attempt_not_found`.
- Preflight from the web app: `curl -i -X OPTIONS .../generate-feedback -H "Origin: http://localhost:5173"` → `204` with `Access-Control-Allow-Origin`.

Logs: `npx supabase functions logs generate-feedback` (failure codes only; no metrics or notes are logged).

## Errors

Non-2xx bodies are `{ "error": { "code", "message", "recovery", "retry_after_s"? } }`; the copy is in `FAILURES` in `contract.ts`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | Body is not `{ attempt_id: uuid }` |
| 401 | `unauthorized` | Missing or invalid JWT |
| 403 | `consent_required` | No active `ai_metrics_only` consent |
| 404 | `attempt_not_found` | No metrics row visible to the caller |
| 405 | `method_not_allowed` | Not POST |
| 422 | `nothing_measured` | Every metric is null; the model is not called |
| 422 | `model_refused` | `finish_reason: content_filter` (or a safety reason, or a `refusal` field) |
| 429 | `rate_limited` | 20 notes in the last hour (`Retry-After` header) |
| 500 | `not_configured` | `LLM_API_KEY`, `LLM_BASE_URL` or `LLM_MODEL` missing, or the key rejected (401/403, or 400 naming the API key) |
| 500 | `storage_failed` | The note could not be inserted |
| 500 | `internal` | Database error or unexpected failure |
| 502 | `model_truncated` | `finish_reason: length` |
| 502 | `model_invalid_output` | Any other `finish_reason`, a body that is not a chat completion, or an answer that failed validation |
| 502 | `upstream_error` | Connection error, or another 4xx from the provider (e.g. an unknown model id) |
| 503 | `upstream_busy` | Provider 429 or 5xx after one retry |
| 504 | `upstream_timeout` | No answer within 30 seconds |
