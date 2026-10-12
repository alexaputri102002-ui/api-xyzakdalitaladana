# Private Discord API

Vercel serverless API for sending registration data to one configured Discord channel.
The endpoint requires a valid Firebase Authentication ID token. Firebase Admin
credentials and the Discord bot token stay on the backend and must never be included
in the APK.

## Configure Discord

1. Create a Discord application and bot in the Discord Developer Portal.
2. Add the bot to the intended server with permission to view the target channel and
   send messages.
3. Copy the bot token, server ID, and target channel ID. Enable Developer Mode in
   Discord to copy server and channel IDs.
4. Create a Firebase service account for the same Firebase project as the Android
   app. Add these environment variables to the Vercel project:

   - `FIREBASE_PROJECT_ID`: the Firebase project ID.
   - `FIREBASE_CLIENT_EMAIL`: the service account email.
   - `FIREBASE_PRIVATE_KEY`: the service account private key. If entering it as one
     line, preserve newline escapes (`\n`); the API converts them when initializing
     Firebase Admin.
   - `DISCORD_BOT_TOKEN`: the bot token. Never expose it to callers.
   - `DISCORD_GUILD_ID`: the intended server ID.
   - `DISCORD_CHANNEL_ID`: the destination channel ID.

Do not commit the service account key or put it in the APK. Redeploy after adding or
changing environment variables. The API checks the Firebase ID token and verifies
that the configured channel belongs to the configured server before sending each
message.

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

## Local tests

```sh
npm test
```
