const { test } = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/login");
const firebase = require("../api/firebase");

const originalEnv = {
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
  DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
  DISCORD_LOGIN_CHANNEL_ID: process.env.DISCORD_LOGIN_CHANNEL_ID,
};
const originalVerifyIdToken = firebase.verifyIdToken;
const originalFetch = global.fetch;
const VALID_TOKEN = "valid-firebase-token";

function setEnvironment() {
  process.env.FIREBASE_PROJECT_ID = "test-project";
  process.env.FIREBASE_CLIENT_EMAIL = "test@example.com";
  process.env.FIREBASE_PRIVATE_KEY = "test-private-key";
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_GUILD_ID = "guild-1";
  process.env.DISCORD_CHANNEL_ID = "channel-1";
  process.env.DISCORD_LOGIN_CHANNEL_ID = "login-data-channel";
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

function createRequest(body, authorization = `Bearer ${VALID_TOKEN}`) {
  return {
    method: "POST",
    headers: authorization ? { authorization } : {},
    body,
  };
}

function createMessage(status = "approved", id = "123", name = "tester", deviceId = "android-1") {
  return {
    id: "message-1",
    embeds: [{
      fields: [
        { name: "ID UNIK DC", value: id },
        { name: "Nama UCP", value: name },
        { name: "android_id", value: deviceId },
        { name: "Status", value: status },
      ],
    }],
  };
}

function installDiscordMock(pages) {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) {
      return { ok: true, json: async () => ({ guild_id: "guild-1" }) };
    }
    return { ok: true, json: async () => pages.shift() || [] };
  };
  return requests;
}

firebase.verifyIdToken = async (idToken) => {
  if (idToken !== VALID_TOKEN) {
    throw Object.assign(new Error("Invalid Firebase ID token"), {
      code: "auth/invalid-id-token",
    });
  }
  return { uid: "test-user" };
};

test("logs in when unique ID, UCP name, device, and active status match", async () => {
  setEnvironment();
  const requests = installDiscordMock([[createMessage()]]);
  const res = createResponse();

  await handler(createRequest({
    id_unik_dc: "123",
    nama_ucp: "Tester",
    android_id: "android-1",
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    success: true,
    message: "Berhasil masuk.",
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers.Authorization, "Bot bot-token");
  assert.match(requests[0].url, /channels\/login-data-channel$/);
  assert.match(requests[1].url, /channels\/login-data-channel\/messages/);
  assert.doesNotMatch(requests[1].url, /channels\/channel-1\//);
  assert.match(requests[1].url, /limit=100/);
});

test("paginates the channel history to find older registrations", async () => {
  setEnvironment();
  const oldMessages = Array.from({ length: 100 }, (_, index) => ({
    id: `message-${100 - index}`,
    embeds: [],
  }));
  const requests = installDiscordMock([oldMessages, [createMessage()]]);
  const res = createResponse();

  await handler(createRequest({
    id_unik_dc: "123",
    nama_ucp: "tester",
    android_id: "android-1",
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(requests.length, 3);
  assert.match(requests[2].url, /before=message-1/);
});

test("reports which supplied credential did not match", async (t) => {
  setEnvironment();
  const cases = [
    {
      name: "unknown unique ID",
      credentials: { id_unik_dc: "missing", nama_ucp: "tester", android_id: "android-1" },
      status: 404,
      error: "ACCOUNT_NOT_FOUND",
    },
    {
      name: "incorrect UCP name",
      credentials: { id_unik_dc: "123", nama_ucp: "wrong", android_id: "android-1" },
      status: 401,
      error: "UCP_NAME_MISMATCH",
    },
    {
      name: "incorrect device",
      credentials: { id_unik_dc: "123", nama_ucp: "tester", android_id: "other-device" },
      status: 401,
      error: "DEVICE_MISMATCH",
    },
    {
      name: "inactive account",
      credentials: { id_unik_dc: "123", nama_ucp: "tester", android_id: "android-1" },
      message: createMessage("pending"),
      status: 403,
      error: "ACCOUNT_NOT_ACTIVE",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const originalFetchForCase = global.fetch;
      installDiscordMock([[scenario.message || createMessage()]]);
      try {
        const res = createResponse();
        await handler(createRequest(scenario.credentials), res);
        assert.equal(res.statusCode, scenario.status);
        assert.equal(res.body.error, scenario.error);
        assert.equal(res.body.success, false);
      } finally {
        global.fetch = originalFetchForCase;
      }
    });
  }
});

test("rejects malformed credentials before contacting Discord", async () => {
  setEnvironment();
  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  const res = createResponse();

  await handler(createRequest({ id_unik_dc: "123", nama_ucp: "tester" }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "INVALID_REQUEST");
});

test("allows POST only", async () => {
  setEnvironment();
  const res = createResponse();

  await handler({ method: "GET", headers: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
  assert.equal(res.body.error, "METHOD_NOT_ALLOWED");
});

test("restores environment variables and mocks after tests", () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  firebase.verifyIdToken = originalVerifyIdToken;
  global.fetch = originalFetch;
});
