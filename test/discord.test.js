const { test } = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/discord");

const originalEnv = {
  API_SECRET: process.env.API_SECRET,
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
  DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
};

function setEnvironment() {
  process.env.API_SECRET = "test-secret";
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_GUILD_ID = "guild-1";
  process.env.DISCORD_CHANNEL_ID = "channel-1";
}

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequest(body, authorization = "Bearer test-secret") {
  return {
    method: "POST",
    headers: { authorization },
    body,
  };
}

test("requires the API secret before sending anything to Discord", async () => {
  setEnvironment();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  try {
    const res = createResponse();
    await handler(createRequest({}, "Bearer wrong-secret"), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, "UNAUTHORIZED");
    assert.match(res.body.message, /secret/i);
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects missing fields", async () => {
  setEnvironment();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  try {
    const res = createResponse();
    await handler(createRequest({ id_unik_dc: "123" }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, "INVALID_REQUEST");
  } finally {
    global.fetch = originalFetch;
  }
});

test("verifies the server and sends all fields to the configured channel", async () => {
  setEnvironment();
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) {
      return {
        ok: true,
        json: async () => ({ guild_id: "guild-1" }),
      };
    }
    return {
      ok: true,
      json: async () => ({ id: "message-1" }),
    };
  };

  try {
    const res = createResponse();
    await handler(
      createRequest({
        id_unik_dc: "123",
        code_verifikasi: "ABC",
        nama_ucp: "tester",
        android_id: "android-1",
        id_daftar_unik: "signup-1",
      }),
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      ok: true,
      success: true,
      message: "Berhasil dikirim ke Discord.",
      message_id: "message-1",
    });
    assert.equal(requests.length, 2);
    assert.equal(
      requests[1].url,
      "https://discord.com/api/v10/channels/channel-1/messages",
    );
    assert.equal(requests[1].options.headers.Authorization, "Bot bot-token");
    const sentBody = JSON.parse(requests[1].options.body);
    assert.deepEqual(
      sentBody.embeds[0].fields.map((field) => field.value),
      ["123", "ABC", "tester", "android-1", "signup-1"],
    );
    assert.deepEqual(sentBody.allowed_mentions, { parse: [] });
  } finally {
    global.fetch = originalFetch;
  }
});

test("does not send if the channel belongs to a different server", async () => {
  setEnvironment();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ guild_id: "different-guild" }),
    };
  };

  try {
    const res = createResponse();
    await handler(
      createRequest({
        id_unik_dc: "123",
        code_verifikasi: "ABC",
        nama_ucp: "tester",
        android_id: "android-1",
        id_daftar_unik: "signup-1",
      }),
      res,
    );
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, "DISCORD_SERVER_MISMATCH");
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("allows POST only", async () => {
  setEnvironment();
  const res = createResponse();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, "METHOD_NOT_ALLOWED");
  assert.equal(res.headers.Allow, "POST");
});

test("reports when Discord rejects the message", async () => {
  setEnvironment();
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        json: async () => ({ guild_id: "guild-1" }),
      };
    }
    return { ok: false, status: 403 };
  };

  try {
    const res = createResponse();
    await handler(
      createRequest({
        id_unik_dc: "123",
        code_verifikasi: "ABC",
        nama_ucp: "tester",
        android_id: "android-1",
        id_daftar_unik: "signup-1",
      }),
      res,
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, "DISCORD_SEND_FAILED");
    assert.equal(res.body.discord_status, 403);
    assert.match(res.body.message, /izin bot/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("restores environment variables after the tests", () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
