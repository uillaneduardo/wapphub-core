import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { buildApp } from "../src/http/app.js";
import { loadConfig } from "../src/infrastructure/config.js";
import {
  hashPassword,
  digest,
  encryptSecret,
  decryptSecret,
} from "../src/infrastructure/crypto.js";
// The suite authorizes an isolated web client fixture, never the deployed API hostname.
const config = loadConfig({
  ...process.env,
  WEB_ORIGINS: "https://web-client.example.test",
});
const db = new PrismaClient();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
redis.on("error", () => {});
const app = await buildApp({ ...config, NODE_ENV: "test" }, db, redis, false);
const prefix = randomUUID();
const password = "Test-password-long-42!";
let userA: string,
  userB: string,
  orgA: string,
  orgB: string,
  orgC: string,
  role: string,
  deniedRole: string,
  permission: string;
let ip = 1;
const email = (label: string) => `${label}-${prefix}@example.test`;
const origin = config.origins[0]!;
type Login = { cookie: string; csrf: string; token: string };
async function login(
  label = "a",
  pass = password,
  address = `192.0.2.${ip++}`,
): Promise<Login> {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    remoteAddress: address,
    headers: { origin },
    payload: { email: email(label), password: pass },
  });
  assert.equal(r.statusCode, 200, r.body);
  const cookies = r.cookies;
  const session = cookies.find((c) => c.name === "wapphub_session")!;
  return {
    cookie: `wapphub_session=${session.value}`,
    token: session.value,
    csrf: r.json().csrfToken,
  };
}
async function select(auth: Login, organizationId: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/session/organization",
    headers: { origin, cookie: auth.cookie, "x-csrf-token": auth.csrf },
    payload: { organizationId },
  });
}
before(async () => {
  await app.ready();
  const passwordHash = await hashPassword(password);
  permission = (
    await db.permission.create({ data: { code: `test.${prefix}` } })
  ).id;
  role = (
    await db.role.create({
      data: {
        code: prefix,
        permissions: {
          create: { permission: { connect: { id: permission } } },
        },
      },
    })
  ).id;
  const read = await db.permission.upsert({
    where: { code: "organization.read" },
    create: { code: "organization.read" },
    update: {},
  });
  await db.rolePermission.create({
    data: { roleId: role, permissionId: read.id },
  });
  deniedRole = (
    await db.role.create({ data: { code: `d${prefix.slice(0, 35)}` } })
  ).id;
  userA = (
    await db.user.create({
      data: { name: "A", email: email("a"), passwordHash },
    })
  ).id;
  userB = (
    await db.user.create({
      data: { name: "B", email: email("b"), passwordHash },
    })
  ).id;
  orgA = (await db.organization.create({ data: { name: `A ${prefix}` } })).id;
  orgB = (await db.organization.create({ data: { name: `B ${prefix}` } })).id;
  orgC = (await db.organization.create({ data: { name: `C ${prefix}` } })).id;
  await db.membership.createMany({
    data: [
      { userId: userA, organizationId: orgA, roleId: role },
      { userId: userA, organizationId: orgC, roleId: role },
      { userId: userB, organizationId: orgB, roleId: role },
    ],
  });
});
after(async () => {
  await app.close();
  if (userA && userB) {
    await db.auditEvent.deleteMany({
      where: { actorUserId: { in: [userA, userB] } },
    });
    await db.securityEvent.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
    await db.session.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await db.membership.deleteMany({
      where: { userId: { in: [userA, userB] } },
    });
    await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await db.organization.deleteMany({
      where: { id: { in: [orgA, orgB, orgC] } },
    });
    await db.rolePermission.deleteMany({
      where: { roleId: { in: [role, deniedRole] } },
    });
    await db.role.deleteMany({ where: { id: { in: [role, deniedRole] } } });
    await db.permission.deleteMany({ where: { id: permission } });
  }
  await db.$disconnect();
  await redis.quit();
});
test("health and readiness prove MariaDB and Redis connectivity", async () => {
  assert.equal((await app.inject("/api/v1/health")).statusCode, 200);
  assert.equal((await app.inject("/api/v1/health/ready")).statusCode, 200);
});
test("login stores only hashes and emits secure session attributes", async () => {
  const auth = await login();
  const stored = await db.session.findUniqueOrThrow({
    where: { tokenHash: digest(auth.token) },
  });
  assert.notEqual(stored.tokenHash, auth.token);
  assert.equal(stored.csrfHash, digest(auth.csrf));
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    remoteAddress: `192.0.2.${ip++}`,
    headers: { origin },
    payload: { email: email("a"), password },
  });
  assert.match(String(r.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(r.headers["set-cookie"]), /SameSite=Strict/);
  assert.doesNotMatch(r.body, /passwordHash|tokenHash/);
});
test("unknown email and incorrect password have identical safe responses", async () => {
  for (const label of ["missing", "a"]) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: `192.0.2.${ip++}`,
      headers: { origin },
      payload: { email: email(label), password: "incorrect" },
    });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().error.code, "INVALID_CREDENTIALS");
    assert.doesNotMatch(r.body, /Prisma|stack|password|incorrect/);
  }
});
test("protected routes reject missing or forged sessions", async () => {
  for (const url of [
    "/api/v1/me",
    "/api/v1/me/organizations",
    "/api/v1/app/bootstrap",
  ]) {
    assert.equal((await app.inject(url)).statusCode, 401);
    assert.equal(
      (await app.inject({ url, headers: { cookie: "wapphub_session=forged" } }))
        .statusCode,
      401,
    );
  }
});
test("organization list and bootstrap isolate A from B; permissions come from Membership", async () => {
  const auth = await login();
  const list = await app.inject({
    url: "/api/v1/me/organizations",
    headers: { cookie: auth.cookie },
  });
  assert.deepEqual(
    new Set(list.json().organizations.map((o: { id: string }) => o.id)),
    new Set([orgA, orgC]),
  );
  assert.equal((await select(auth, orgB)).statusCode, 403);
  assert.equal((await select(auth, orgA)).statusCode, 200);
  const boot = await app.inject({
    url: "/api/v1/app/bootstrap",
    headers: { cookie: auth.cookie },
  });
  assert.equal(boot.statusCode, 200);
  assert.equal(boot.json().organization.id, orgA);
  assert.ok(boot.json().permissions.includes("organization.read"));
  assert.doesNotMatch(boot.body, new RegExp(orgB));
  assert.equal((await select(auth, orgC)).statusCode, 200);
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/app/bootstrap",
        headers: { cookie: auth.cookie },
      })
    ).json().organization.id,
    orgC,
  );
  const b = await login("b");
  assert.equal((await select(b, orgA)).statusCode, 403);
});
test("bootstrap requires explicit authorized context", async () => {
  const auth = await login();
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/app/bootstrap",
        headers: { cookie: auth.cookie },
      })
    ).statusCode,
    409,
  );
});
test("revoked Membership invalidates selected context on every protected read", async () => {
  const auth = await login();
  await select(auth, orgA);
  await db.membership.update({
    where: { userId_organizationId: { userId: userA, organizationId: orgA } },
    data: { status: "SUSPENDED" },
  });
  try {
    for (const url of [
      "/api/v1/me",
      "/api/v1/me/organizations",
      "/api/v1/app/bootstrap",
    ])
      assert.equal(
        (await app.inject({ url, headers: { cookie: auth.cookie } }))
          .statusCode,
        403,
      );
    const fresh = await login();
    assert.equal((await select(fresh, orgA)).statusCode, 403);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/logout",
          headers: { origin, cookie: auth.cookie, "x-csrf-token": auth.csrf },
        })
      ).statusCode,
      204,
    );
  } finally {
    await db.membership.update({
      where: { userId_organizationId: { userId: userA, organizationId: orgA } },
      data: { status: "ACTIVE" },
    });
  }
});
test("permission is revalidated and denied without organization.read", async () => {
  const auth = await login();
  await db.membership.update({
    where: { userId_organizationId: { userId: userA, organizationId: orgA } },
    data: { roleId: deniedRole },
  });
  try {
    assert.equal((await select(auth, orgA)).statusCode, 403);
  } finally {
    await db.membership.update({
      where: { userId_organizationId: { userId: userA, organizationId: orgA } },
      data: { roleId: role },
    });
  }
});
test("inactive Organization and User cannot access context", async () => {
  const auth = await login();
  await db.organization.update({
    where: { id: orgA },
    data: { status: "SUSPENDED" },
  });
  try {
    assert.equal((await select(auth, orgA)).statusCode, 403);
  } finally {
    await db.organization.update({
      where: { id: orgA },
      data: { status: "ACTIVE" },
    });
  }
  await db.user.update({ where: { id: userA }, data: { status: "SUSPENDED" } });
  try {
    assert.equal(
      (
        await app.inject({
          url: "/api/v1/me",
          headers: { cookie: auth.cookie },
        })
      ).statusCode,
      401,
    );
  } finally {
    await db.user.update({ where: { id: userA }, data: { status: "ACTIVE" } });
  }
});
test("CSRF requires trusted Origin and session-bound token including logout", async () => {
  const auth = await login(),
    other = await login();
  for (const headers of [
    { cookie: auth.cookie },
    {
      origin: "https://evil.test",
      cookie: auth.cookie,
      "x-csrf-token": auth.csrf,
    },
    { origin, cookie: auth.cookie, "x-csrf-token": other.csrf },
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/session/organization",
          headers,
          payload: { organizationId: orgA },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/logout",
          headers,
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: email("a"), password },
      })
    ).statusCode,
    403,
  );
});
test("logout immediately revokes persisted session and records SecurityEvent", async () => {
  const auth = await login();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { origin, cookie: auth.cookie, "x-csrf-token": auth.csrf },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: "/api/v1/me", headers: { cookie: auth.cookie } }))
      .statusCode,
    401,
  );
  assert.ok(
    await db.securityEvent.findFirst({
      where: { userId: userA, type: "SESSION_REVOKED" },
    }),
  );
});
test("absolute and idle expiration prevent session reuse", async () => {
  for (const data of [
    { expiresAt: new Date(Date.now() - 1000) },
    {
      lastSeenAt: new Date(
        Date.now() - (config.SESSION_IDLE_SECONDS + 1) * 1000,
      ),
    },
  ]) {
    const auth = await login();
    await db.session.update({ where: { tokenHash: digest(auth.token) }, data });
    assert.equal(
      (
        await app.inject({
          url: "/api/v1/me",
          headers: { cookie: auth.cookie },
        })
      ).statusCode,
      401,
    );
  }
});
test("relogin rotates and revokes old session", async () => {
  const auth = await login();
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    remoteAddress: `192.0.2.${ip++}`,
    headers: { origin, cookie: auth.cookie },
    payload: { email: email("a"), password },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(
    (await app.inject({ url: "/api/v1/me", headers: { cookie: auth.cookie } }))
      .statusCode,
    401,
  );
});
test("authentication rate limit is enforced through Redis", async () => {
  const address = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  for (let i = 0; i < 11; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: address,
      headers: { origin },
      payload: { email: email("missing"), password: "wrong" },
    });
    assert.equal(r.statusCode, i === 10 ? 429 : 401);
  }
});
test("validation, unknown routes, headers and CORS are safe", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin },
    payload: { email: email("a"), password, organizationId: orgB },
  });
  assert.equal(r.statusCode, 400);
  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin },
    payload: { email: "invalid", password },
  });
  assert.equal(invalid.statusCode, 400);
  const health = await app.inject({
    url: "/api/v1/health",
    headers: { origin: "https://evil.test" },
  });
  assert.equal(health.headers["access-control-allow-origin"], undefined);
  assert.equal(health.headers["cache-control"], "no-store");
  assert.equal(health.headers["x-content-type-options"], "nosniff");
  assert.equal(
    (await app.inject("/api/v1/nope")).json().error.code,
    "NOT_FOUND",
  );
});
test("OpenAPI preserves every foundation and M1 route and adds M2.1 permissions and checkpoint 3 Web connections", async () => {
  const doc = (await app.inject("/api/v1/openapi.json")).json();
  const foundationPaths = [
    "/health",
    "/health/ready",
    "/auth/login",
    "/auth/logout",
    "/me",
    "/me/organizations",
    "/session/organization",
    "/app/bootstrap",
  ];
  const chatPaths = [
    "/contacts",
    "/contacts/realtime/events",
    "/contacts/{id}",
    "/conversations",
    "/conversations/{id}",
    "/conversations/{id}/archive",
    "/conversations/{id}/unarchive",
    "/conversations/{id}/messages",
    "/conversations/{id}/messages/{messageId}/status",
    "/conversations/{id}/assign",
    "/conversations/{id}/transfer",
    "/tags",
    "/tags/{id}",
    "/conversations/{id}/tags/{tagId}",
    "/conversations/{id}/notes",
    "/realtime/events",
    "/team/members",
    "/resources",
    "/permissions",
    "/team/directory",
    "/team/members/{membershipId}/permissions",
    "/team/members/{membershipId}/permissions/reset",
    "/providers",
    "/providers/demo",
    "/providers/demo/contacts",
    "/providers/demo/messages",
    "/providers/realtime/events",
    "/providers/whatsapp-web/connections",
    "/providers/whatsapp-web/connections/{id}/commands",
    "/providers/whatsapp-web/connections/{id}/qr",
    "/providers/{provider}/diagnostics",
    "/providers/{provider}/diagnostics/health",
    "/providers/{provider}/diagnostics/{id}",
  ];
  assert.deepEqual(
    Object.keys(doc.paths).sort(),
    [...foundationPaths, ...chatPaths].map((p) => "/api/v1" + p).sort(),
  );
  assert.ok(doc.paths["/api/v1/app/bootstrap"].get.security);
  assert.ok(doc.paths["/api/v1/session/organization"].post.security[0].csrf);
  assert.ok(doc.paths["/api/v1/providers/demo"].put.security[0].csrf);
  assert.ok(doc.paths["/api/v1/providers/whatsapp-web/connections/{id}/commands"].post.security[0].csrf);
  assert.ok(doc.paths["/api/v1/providers/whatsapp-web/connections/{id}/qr"].get.security[0].webSession);
  assert.doesNotMatch(
    JSON.stringify(doc),
    /MetaIntegration|subscriptions/,
  );
});
test("context selection is tenant-scoped in audit records", async () => {
  assert.ok(
    await db.auditEvent.findFirst({
      where: {
        organizationId: orgA,
        actorUserId: userA,
        action: "ORGANIZATION_CONTEXT_SELECTED",
      },
    }),
  );
  assert.equal(
    await db.auditEvent.count({
      where: { organizationId: orgB, actorUserId: userA },
    }),
    0,
  );
});
test("encryption authenticates tenant scope and supports key versions", () => {
  const secret = encryptSecret("sensitive", config.ENCRYPTION_KEY, "1", orgA);
  assert.equal(
    decryptSecret(secret, { "1": config.ENCRYPTION_KEY }, orgA),
    "sensitive",
  );
  assert.throws(() =>
    decryptSecret(secret, { "1": config.ENCRYPTION_KEY }, orgB),
  );
  assert.throws(() => decryptSecret(secret, {}, orgA));
  assert.throws(() =>
    decryptSecret(
      secret.slice(0, -2) + "ZZ",
      { "1": config.ENCRYPTION_KEY },
      orgA,
    ),
  );
});

test("internal failures are sanitized in responses and logs; readiness degrades safely", async () => {
  let logs = "";
  const stream = new Writable({
    write(chunk, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  const loggedApp = await buildApp(
    { ...config, NODE_ENV: "test" },
    db,
    redis,
    true,
    stream,
  );
  await loggedApp.ready();
  const original = db.session.findUnique;
  db.session.findUnique = () => {
    throw new Error("Prisma stack SECRET-password-token");
  };
  try {
    const r = await loggedApp.inject({
      url: "/api/v1/me?token=SECRET-query",
      headers: {
        cookie: "wapphub_session=SECRET-cookie",
        authorization: "SECRET-auth",
      },
    });
    assert.equal(r.statusCode, 500);
    assert.equal(r.json().error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(r.body, /SECRET|Prisma|stack/);
    assert.match(logs, /Internal operation failed/);
    assert.doesNotMatch(logs, /SECRET|Prisma|password-token/);
  } finally {
    db.session.findUnique = original;
    await loggedApp.close();
  }
  const ping = redis.ping;
  redis.ping = async () => {
    throw new Error("SECRET-redis");
  };
  try {
    const ready = await app.inject("/api/v1/health/ready");
    assert.equal(ready.statusCode, 503);
    assert.doesNotMatch(ready.body, /SECRET/);
  } finally {
    redis.ping = ping;
  }
});
test("production uses Secure host-only session cookies", async () => {
  const production = await buildApp(
    { ...config, NODE_ENV: "production" },
    db,
    redis,
    false,
  );
  try {
    const r = await production.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: `192.0.2.${ip++}`,
      headers: { origin },
      payload: { email: email("a"), password },
    });
    assert.equal(r.statusCode, 200);
    assert.match(String(r.headers["set-cookie"]), /__Host-wapphub_session/);
    assert.match(String(r.headers["set-cookie"]), /Secure/);
    assert.doesNotMatch(String(r.headers["set-cookie"]), /Domain=/);
  } finally {
    await production.close();
  }
});

test("client-supplied tenant identifiers cannot change bootstrap scope", async () => {
  const auth = await login();
  await select(auth, orgA);
  const r = await app.inject({
    url: `/api/v1/app/bootstrap?organizationId=${orgB}`,
    headers: { cookie: auth.cookie, "x-organization-id": orgB },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().organization.id, orgA);
  await db.session.update({
    where: { tokenHash: digest(auth.token) },
    data: { currentOrganizationId: orgB },
  });
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/app/bootstrap",
        headers: { cookie: auth.cookie },
      })
    ).statusCode,
    403,
  );
});
test("oversized payloads return a safe bounded error", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin },
    payload: { email: email("a"), password: "S".repeat(20000) },
  });
  assert.equal(r.statusCode, 413);
  assert.equal(r.json().error.code, "PAYLOAD_TOO_LARGE");
  assert.ok(r.body.length < 256);
});

test("malformed JSON and unsupported content types return safe client errors", async () => {
  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin, "content-type": "application/json" },
    payload: "{invalid-json",
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "INVALID_REQUEST");
  const unsupported = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin, "content-type": "application/xml" },
    payload: "<password>secret</password>",
  });
  assert.equal(unsupported.statusCode, 415);
  assert.equal(unsupported.json().error.code, "UNSUPPORTED_MEDIA_TYPE");
  assert.doesNotMatch(unsupported.body, /secret|password|stack/);
});

test("me restores session-bound CSRF token for cross-origin clients after reload", async () => {
  const auth = await login();
  const r = await app.inject({
    url: "/api/v1/me",
    headers: { origin, cookie: `${auth.cookie}; wapphub_csrf=${auth.csrf}` },
  });
  assert.equal(r.json().csrfToken, auth.csrf);
  assert.equal(r.headers["access-control-allow-origin"], origin);
  const bad = await app.inject({
    url: "/api/v1/me",
    headers: { cookie: `${auth.cookie}; wapphub_csrf=forged` },
  });
  assert.equal(bad.json().csrfToken, null);
});

test("Invitation persistence enforces token uniqueness and author integrity", async () => {
  const tokenHash = digest(randomUUID());
  const data = {
    organizationId: orgA,
    roleId: role,
    invitedByUserId: userA,
    email: email("invite"),
    tokenHash,
    expiresAt: new Date(Date.now() + 3600000),
  };
  try {
    const invite = await db.organizationInvitation.create({ data });
    assert.equal(invite.status, "PENDING");
    assert.equal(invite.acceptedAt, null);
    assert.equal(invite.organizationId, orgA);
    await assert.rejects(
      db.organizationInvitation.create({
        data: { ...data, organizationId: orgB },
      }),
    );
    await assert.rejects(
      db.organizationInvitation.create({
        data: {
          ...data,
          tokenHash: digest(randomUUID()),
          invitedByUserId: randomUUID(),
        },
      }),
    );
    assert.equal(
      await db.organizationInvitation.findFirst({
        where: { id: invite.id, organizationId: orgB },
      }),
      null,
    );
  } finally {
    await db.organizationInvitation.deleteMany({ where: { tokenHash } });
  }
});

test("only the pinned cloudflared peer can separate authentication budgets by visitor IP", async () => {
  const connector = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  const visitor = `198.18.${Math.floor(Math.random() * 200) + 1}.1`;
  const proxied = await buildApp(
    { ...config, NODE_ENV: "test", trustedCloudflaredIPs: [connector] },
    db,
    redis,
    false,
  );
  try {
    for (let attempt = 0; attempt < 11; attempt++) {
      const r = await proxied.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        remoteAddress: connector,
        headers: { origin, "cf-connecting-ip": visitor },
        payload: { email: email("missing"), password: "incorrect" },
      });
      assert.equal(r.statusCode, attempt === 10 ? 429 : 401);
    }
    const different = await proxied.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: connector,
      headers: { origin, "cf-connecting-ip": visitor.replace(/\.1$/, ".2") },
      payload: { email: email("missing"), password: "incorrect" },
    });
    assert.equal(different.statusCode, 401);
  } finally {
    await proxied.close();
  }
});

test("untrusted forwarded headers and malformed visitor IPs cannot bypass the peer budget", async () => {
  const untrusted = `198.19.${Math.floor(Math.random() * 200) + 1}.1`;
  const trusted = `198.19.${Math.floor(Math.random() * 200) + 1}.2`;
  const proxied = await buildApp(
    { ...config, NODE_ENV: "test", trustedCloudflaredIPs: [trusted] },
    db,
    redis,
    false,
  );
  try {
    for (const peer of [untrusted, trusted]) {
      for (let attempt = 0; attempt < 11; attempt++) {
        const visitor =
          peer === trusted ? `invalid-${attempt}` : `192.0.2.${attempt + 1}`;
        const r = await proxied.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          remoteAddress: peer,
          headers: {
            origin,
            "cf-connecting-ip": visitor,
            "x-forwarded-for": `192.0.2.${attempt + 1}`,
          },
          payload: { email: email("missing"), password: "incorrect" },
        });
        assert.equal(r.statusCode, attempt === 10 ? 429 : 401);
      }
    }
  } finally {
    await proxied.close();
  }
});

test("connector configuration rejects wildcard and subnet trust", () => {
  for (const value of ["*", "172.19.0.0/16", "true", "cloudflared"]) {
    assert.throws(
      () => loadConfig({ ...process.env, CLOUDFLARED_TRUSTED_IPS: value }),
      /Invalid trusted connector configuration/,
    );
  }
  assert.throws(
    () =>
      loadConfig({
        ...process.env,
        NODE_ENV: "production",
        WEB_ORIGINS: "http://localhost:5173",
      }),
    /Invalid WEB_ORIGINS/,
  );
});

test("the public API hostname grants no client origin permission and empty WEB_ORIGINS denies web commands", async () => {
  const apiOrigin = "https://api.wapphub.com.br";
  const rejected = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: apiOrigin },
    payload: { email: email("a"), password },
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.json().error.code, "ORIGIN_REJECTED");
  const health = await app.inject({
    url: "/api/v1/health",
    headers: { origin: apiOrigin },
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers["access-control-allow-origin"], undefined);
  const closedConfig = loadConfig({ ...process.env, WEB_ORIGINS: "" });
  assert.deepEqual(closedConfig.origins, []);
  const closed = await buildApp(
    { ...closedConfig, NODE_ENV: "test" },
    db,
    redis,
    false,
  );
  try {
    const result = await closed.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin },
      payload: { email: email("a"), password },
    });
    assert.equal(result.statusCode, 403);
    assert.equal(result.json().error.code, "ORIGIN_REJECTED");
    const ready = await closed.inject({
      url: "/api/v1/health/ready",
      headers: { origin },
    });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.headers["access-control-allow-origin"], undefined);
  } finally {
    await closed.close();
  }
});
