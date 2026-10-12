# Private Discord API

Vercel serverless API for registration and login using Discord channels. Both
endpoints require a valid Firebase Authentication ID token.
Firebase Admin credentials and the Discord bot token stay on the backend and must
never be included in the APK.

## Configure Discord

1. Create a Discord application and bot in the Discord Developer Portal.
2. Add the bot to the intended server with permission to view the registration
   channel and the login-data channel, send messages in the registration channel,
   and read message history in the login-data channel.
3. Copy the bot token, server ID, registration channel ID, and login-data channel
   ID. Enable Developer Mode in Discord to copy server and channel IDs.
4. Create a Firebase service account for the same Firebase project as the Android
   app. Add these environment variables to the Vercel project:

   - `FIREBASE_PROJECT_ID`: the Firebase project ID.
   - `FIREBASE_CLIENT_EMAIL`: the service account email.
   - `FIREBASE_PRIVATE_KEY`: the service account private key. If entering it as one
     line, preserve newline escapes (`\n`); the API converts them when initializing
     Firebase Admin.
   - `DISCORD_BOT_TOKEN`: the bot token. Never expose it to callers.
   - `DISCORD_GUILD_ID`: the intended server ID.
   - `DISCORD_CHANNEL_ID`: the channel where `/api/discord` posts new registrations.
   - `DISCORD_LOGIN_CHANNEL_ID`: the separate channel whose records `/api/login`
     checks. Set it to the channel containing the ID, UCP name, Android ID, and
     status fields.

Do not commit the service account key or put it in the APK. Redeploy after adding or
changing environment variables. The API checks the Firebase ID token and verifies
that each configured channel belongs to the configured server. The login endpoint
reads the login-data channel's message history, so the bot needs the
`Read Message History` permission there.

## Request

The Android app must first sign the user in with Firebase Authentication. Then send a
`POST` request to `/api/discord` with the user's Firebase ID token as a bearer token
in the `Authorization` header and set `Content-Type: application/json`:


```json
{
  "id_unik_dc": "123456789012345678",
  "code_verifikasi": "ABC123",
  "nama_ucp": "nama_ucp",
  "android_id": "perangkat-unik",
  "id_daftar_unik": "daftar-unik-001"
}
```

All five values are required as non-empty strings and may contain up to 1024
characters each. On success, the API responds with:

```json
{
  "ok": true,
  "success": true,
  "message": "Berhasil dikirim ke Discord.",
  "message_id": "123456789012345678"
}
```

The Discord message is sent as an embed. Mentions in submitted values are disabled.
Responses include `success` and a readable Indonesian `message`, so the calling
application can show whether delivery succeeded. On failure, `success` is `false`
and `error` contains a machine-readable error code. For example:

```json
{
  "ok": false,
  "success": false,
  "error": "DISCORD_SEND_FAILED",
  "message": "Discord menolak pesan. Periksa izin bot untuk mengirim pesan di channel tersebut.",
  "discord_status": 403
}
```

The HTTP status also indicates the outcome: `200` for successful delivery, `401` for
a missing or invalid Firebase ID token, `400` for invalid data, `502` if Discord
cannot be reached or rejects a request, and `503` if Firebase token verification is
temporarily unavailable.

## Login

The client signs the user in with Firebase Authentication, then sends a `POST`
request to `/api/login` with the Firebase ID token as a bearer token and
`Content-Type: application/json`. The form only needs to show `id_unik_dc` and
`nama_ucp`; the app should read the device's Android ID and send it automatically as
`android_id`:

```json
{
  "id_unik_dc": "123456789012345678",
  "nama_ucp": "nama_ucp",
  "android_id": "perangkat-unik"
}
```

The endpoint checks the ID, UCP name (case-insensitive), Android ID, and account
status in the channel configured by `DISCORD_LOGIN_CHANNEL_ID`. All three request
values must be non-empty strings of at most 1024 characters. On success:

```json
{
  "ok": true,
  "success": true,
  "message": "Berhasil masuk."
}
```

Login returns a specific error for an unknown ID, incorrect UCP name, or a device
that does not match the registered Android ID. Only records with status `aktif` or
`approved` can log in. New registrations are recorded with status `pending`, so an
administrator must change the `Status` field in the Discord embed to `aktif` or
`approved` after approving the account. The login endpoint scans channel history;
it may require multiple Discord requests when the channel contains more than 100
messages. Older registration embeds without a `Status` field are treated as
inactive until an administrator adds and updates that field.

## Local tests

```sh
npm test
```
