# delete-account

Supabase Edge Function (Deno) that deletes the caller's account (FR-3.9.x).

`POST { "confirm": "DELETE" }` with the user's JWT → `DeleteAccountReport` (`contract.ts`):
rows the account owned per table, stored files removed per bucket, and `rows_left`
(rows found after the delete; 0 when the cascade worked, null if the recount failed).

## What it does

1. Takes the user id only from the verified access token (`auth.getUser(token)`); the body carries no id. The id must be a uuid, since it is the storage prefix.
2. Counts the user's rows in every table with `owner_id` (for the report).
3. Lists and removes every file under `keypoints/{uid}/` and `videos/{uid}/` (sub-folders too, in batches of 100), then lists again. If anything is left, it stops with `storage_incomplete` and **keeps the account**, so the user can retry.
4. Deletes the auth user with `auth.admin.deleteUser`. Every table references `auth.users` with `ON DELETE CASCADE` (see `supabase/migrations/20261115000000_init.sql`), so the rows go with it.
5. Counts again and returns the report.

`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are injected by the platform. The key never leaves the function and is used only for the caller's own folder, rows and user. Logs carry codes and counts only.

## Files

| File | Purpose |
| --- | --- |
| `index.ts` | Deno entry: CORS (shared `../generate-feedback/cors.ts`), service-role client, real Storage/Auth calls |
| `handler.ts` | The request flow with everything injected (tested in `src/data/deleteAccount.test.ts`) |
| `contract.ts` | Types, confirm word, error codes and dancer-safe copy, shared with `src/data/deleteData.ts` |

## Deploy

```
npx supabase functions deploy delete-account --use-api
```

JWT verification stays on (the default). The browser calls it through
`deleteAccount(client, typed)` in `src/data/deleteData.ts`.
