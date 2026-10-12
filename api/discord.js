const firebase = require("./firebase");

const FIELD_DEFINITIONS = [
  ["id_unik_dc", "ID UNIK DC"],
  ["code_verifikasi", "CODE VERIFIKASI"],
  ["nama_ucp", "Nama UCP"],
  ["android_id", "android_id"],
  ["id_daftar_unik", "ID_DAFTAR_UNIK"],
  ["status", "Status"],
];

function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function sendError(res, status, error, message, details = {}) {
  return sendJson(res, status, {
    ok: false,
    success: false,
    error,
    message,
    ...details,
  });
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();
  return token || null;
}

function getValidatedFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const fields = [];
  for (const [key, label] of FIELD_DEFINITIONS) {
    const value = key === "status" ? "pending" : body[key];
    if (key === "status") {
      fields.push({ name: label, value, inline: false });
      continue;
    }
    if (typeof value !== "string" || !value.trim() || value.trim().length > 1024) {
      return null;
    }
    fields.push({ name: label, value: value.trim(), inline: false });
  }

  return fields;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendError(res, 405, "METHOD_NOT_ALLOWED", "Gunakan method POST.");
  }

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    DISCORD_BOT_TOKEN,
    DISCORD_GUILD_ID,
    DISCORD_CHANNEL_ID,
  } = process.env;
  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_CLIENT_EMAIL ||
    !FIREBASE_PRIVATE_KEY ||
    !DISCORD_BOT_TOKEN ||
    !DISCORD_GUILD_ID ||
    !DISCORD_CHANNEL_ID
  ) {
    return sendError(
      res,
      500,
      "API_NOT_CONFIGURED",
      "API belum dikonfigurasi dengan lengkap di environment variables Vercel.",
    );
  }

  const idToken = getBearerToken(req);
  if (!idToken) {
    return sendError(res, 401, "UNAUTHORIZED", "Firebase ID token tidak ada atau tidak valid.");
  }

  try {
    await firebase.verifyIdToken(idToken);
  } catch (error) {
    if (firebase.isInvalidIdTokenError(error)) {
      return sendError(res, 401, "UNAUTHORIZED", "Firebase ID token tidak ada atau tidak valid.");
    }
    return sendError(
      res,
      503,
      "AUTHENTICATION_UNAVAILABLE",
      "Layanan autentikasi sementara tidak tersedia. Coba lagi nanti.",
    );
  }

  const fields = getValidatedFields(req.body);
  if (!fields) {
    return sendError(
      res,
      400,
      "INVALID_REQUEST",
      "Semua field wajib diisi sebagai teks (maksimal 1024 karakter): id_unik_dc, code_verifikasi, nama_ucp, android_id, id_daftar_unik.",
    );
  }

  const discordApi = "https://discord.com/api/v10";
  const headers = {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    const channelResponse = await fetch(
      `${discordApi}/channels/${encodeURIComponent(DISCORD_CHANNEL_ID)}`,
      { headers },
    );
    if (!channelResponse.ok) {
      return sendError(
        res,
        502,
        "DISCORD_CHANNEL_CHECK_FAILED",
        "Gagal memeriksa channel Discord. Pastikan ID channel benar dan bot dapat melihat channel.",
        { discord_status: channelResponse.status },
      );
    }

    const channel = await channelResponse.json();
    if (channel.guild_id !== DISCORD_GUILD_ID) {
      return sendError(
        res,
        500,
        "DISCORD_SERVER_MISMATCH",
        "Channel Discord tersebut bukan bagian dari server yang dikonfigurasi.",
      );
    }

    const messageResponse = await fetch(
      `${discordApi}/channels/${encodeURIComponent(DISCORD_CHANNEL_ID)}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          embeds: [{ title: "Data Pendaftaran", fields }],
          allowed_mentions: { parse: [] },
        }),
      },
    );
    if (!messageResponse.ok) {
      return sendError(
        res,
        502,
        "DISCORD_SEND_FAILED",
        "Discord menolak pesan. Periksa izin bot untuk mengirim pesan di channel tersebut.",
        { discord_status: messageResponse.status },
      );
    }

    const message = await messageResponse.json();
    return sendJson(res, 200, {
      ok: true,
      success: true,
      message: "Berhasil dikirim ke Discord.",
      message_id: message.id,
    });
  } catch {
    return sendError(
      res,
      502,
      "DISCORD_CONNECTION_FAILED",
      "Gagal terhubung ke Discord. Coba lagi beberapa saat.",
    );
  }
};
