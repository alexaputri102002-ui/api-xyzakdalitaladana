const firebase = require("./firebase");

const DISCORD_API = "https://discord.com/api/v10";
const PAGE_SIZE = 100;

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

function getValidatedCredentials(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const { id_unik_dc: id, nama_ucp: name, android_id: deviceId } = body;
  if ([id, name, deviceId].some((value) =>
    typeof value !== "string" || !value.trim() || value.trim().length > 1024
  )) {
    return null;
  }

  return {
    id: id.trim(),
    name: name.trim(),
    deviceId: deviceId.trim(),
  };
}

function normalizeFieldName(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function getFieldValues(embed) {
  const values = new Map();
  for (const field of embed.fields || []) {
    const label = normalizeFieldName(field.name);
    if (typeof field.value !== "string") continue;

    if (["idunikdc", "idunik"].includes(label)) values.set("id", field.value.trim());
    if (["namaucp", "nameucp"].includes(label)) values.set("name", field.value.trim());
    if (["androidid", "iddevice", "deviceid"].includes(label)) {
      values.set("deviceId", field.value.trim());
    }
    if (label === "status") values.set("status", field.value.trim());
  }
  return values;
}

function getRecords(messages) {
  const records = [];
  for (const message of messages) {
    for (const embed of message.embeds || []) {
      const fields = getFieldValues(embed);
      if (fields.has("id") && fields.has("name") && fields.has("deviceId")) {
        records.push({
          id: fields.get("id"),
          name: fields.get("name"),
          deviceId: fields.get("deviceId"),
          status: fields.get("status") || "",
        });
      }
    }
  }
  return records;
}

async function fetchChannelMessages(headers) {
  const messages = [];
  let before;

  while (true) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before) params.set("before", before);

    const response = await fetch(
      `${DISCORD_API}/channels/${encodeURIComponent(process.env.DISCORD_LOGIN_CHANNEL_ID)}/messages?${params}`,
      { headers },
    );
    if (!response.ok) {
      return { error: response.status };
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      return { error: 502 };
    }
    if (page.length === 0) break;

    messages.push(...page);
    if (page.length < PAGE_SIZE) break;

    const nextBefore = page[page.length - 1].id;
    if (typeof nextBefore !== "string" || nextBefore === before) {
      return { error: 502 };
    }
    before = nextBefore;
  }

  return { messages };
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
    DISCORD_LOGIN_CHANNEL_ID,
  } = process.env;
  if (
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_CLIENT_EMAIL ||
    !FIREBASE_PRIVATE_KEY ||
    !DISCORD_BOT_TOKEN ||
    !DISCORD_GUILD_ID ||
    !DISCORD_LOGIN_CHANNEL_ID
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

  const credentials = getValidatedCredentials(req.body);
  if (!credentials) {
    return sendError(
      res,
      400,
      "INVALID_REQUEST",
      "Field wajib diisi sebagai teks (maksimal 1024 karakter): id_unik_dc, nama_ucp, android_id.",
    );
  }

  const headers = { Authorization: `Bot ${DISCORD_BOT_TOKEN}` };
  try {
    const channelResponse = await fetch(
      `${DISCORD_API}/channels/${encodeURIComponent(DISCORD_LOGIN_CHANNEL_ID)}`,
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

    const result = await fetchChannelMessages(headers);
    if (result.error) {
      return sendError(
        res,
        502,
        "DISCORD_MESSAGES_FETCH_FAILED",
        "Gagal membaca daftar akun di channel Discord. Periksa izin bot untuk membaca riwayat pesan.",
        { discord_status: result.error },
      );
    }

    const matchingIds = getRecords(result.messages).filter((record) => record.id === credentials.id);
    if (matchingIds.length === 0) {
      return sendError(res, 404, "ACCOUNT_NOT_FOUND", "ID unik tidak ditemukan.");
    }

    const matchingNames = matchingIds.filter(
      (record) => record.name.toLowerCase() === credentials.name.toLowerCase(),
    );
    if (matchingNames.length === 0) {
      return sendError(res, 401, "UCP_NAME_MISMATCH", "Nama UCP tidak sesuai dengan ID unik.");
    }

    const matchingDevices = matchingNames.filter(
      (record) => record.deviceId === credentials.deviceId,
    );
    if (matchingDevices.length === 0) {
      return sendError(res, 401, "DEVICE_MISMATCH", "Perangkat ini tidak sesuai dengan perangkat yang terdaftar.");
    }

    const activeRecord = matchingDevices.find((record) =>
      ["aktif", "approved"].includes(record.status.toLowerCase()),
    );
    if (!activeRecord) {
      return sendError(res, 403, "ACCOUNT_NOT_ACTIVE", "Akun belum aktif atau belum disetujui.");
    }

    return sendJson(res, 200, {
      ok: true,
      success: true,
      message: "Berhasil masuk.",
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
