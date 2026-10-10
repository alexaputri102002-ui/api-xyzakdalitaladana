# Private Discord API

Vercel serverless API for sending registration data to one configured Discord channel.
The endpoint requires a bearer API secret; keep that secret on your trusted backend and
do not put it in a public website or client-side app.

## Configure Discord

1. Create a Discord application and bot in the Discord Developer Portal.
2. Add the bot to the intended server with permission to view the target channel and
   send messages.
3. Copy the bot token, server ID, and target channel ID. Enable Developer Mode in
   Discord to copy server and channel IDs.
4. Add these environment variables to the Vercel project:

   - `API_SECRET`: a long, random secret used by callers.
   - `DISCORD_BOT_TOKEN`: the bot token. Never expose it to callers.
   - `DISCORD_GUILD_ID`: the intended server ID.
   - `DISCORD_CHANNEL_ID`: the destination channel ID.

Redeploy after adding or changing environment variables. The API checks that the
configured channel belongs to the configured server before sending each message.

## Request

Send a `POST` request to `/api/discord`, include your API secret as a bearer token in
the `Authorization` header, and set `Content-Type: application/json`:

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
a missing or invalid secret, `400` for invalid data, and `502` if Discord cannot be
reached or rejects a request.

## Local tests

```sh
npm test
```
