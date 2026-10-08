import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { newToken } from "../src/infrastructure/crypto.js";
import { loadConfig } from "../src/infrastructure/config.js";
const config = loadConfig();
const db = new PrismaClient({ log: [], errorFormat: "minimal" });
const email = `smoke-${randomUUID()}@example.test`;
const password = newToken();
let userId: string | undefined, organizationId: string | undefined;
try {
  const boot = spawnSync(process.execPath, ["dist/scripts/bootstrap.js"], {
    env: {
      ...process.env,
      BOOTSTRAP_EMAIL: email,
      BOOTSTRAP_PASSWORD: password,
      BOOTSTRAP_ORGANIZATION: "M0 smoke fixture",
    },
    encoding: "utf8",
  });
  assert.equal(boot.status, 0);
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    include: { memberships: true },
  });
  userId = user.id;
  organizationId = user.memberships[0]!.organizationId;
  const base = "http://wapphub-core-api:3000/api/v1";
  const origin = config.origins[0]!;
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const data = (await login.json()) as { csrfToken: string };
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const headers = {
    origin,
    cookie,
    "x-csrf-token": data.csrfToken,
    "content-type": "application/json",
  };
  const me = await fetch(`${base}/me`, { headers });
  assert.equal(me.status, 200);
  assert.equal(
    ((await me.json()) as { csrfToken: string }).csrfToken,
    data.csrfToken,
  );
  const list = await fetch(`${base}/me/organizations`, { headers });
  assert.equal(list.status, 200);
  assert.equal(
    ((await list.json()) as { organizations: { id: string }[] })
      .organizations[0]!.id,
    organizationId,
  );
  assert.equal(
    (
      await fetch(`${base}/session/organization`, {
        method: "POST",
        headers,
        body: JSON.stringify({ organizationId }),
      })
    ).status,
    200,
  );
  const bootstrap = await fetch(`${base}/app/bootstrap`, { headers });
  assert.equal(bootstrap.status, 200);
  assert.equal(
    ((await bootstrap.json()) as { organization: { id: string } }).organization
      .id,
    organizationId,
  );
  const { ["content-type"]: contentType, ...logoutHeaders } = headers;
  void contentType;
  assert.equal(
    (
      await fetch(`${base}/auth/logout`, {
        method: "POST",
        headers: logoutHeaders,
      })
    ).status,
    204,
  );
  assert.equal((await fetch(`${base}/me`, { headers })).status, 401);
  process.stdout.write("HTTP smoke and administrative bootstrap passed\n");
} catch {
  process.stderr.write("HTTP smoke failed\n");
  process.exitCode = 1;
} finally {
  // Delete only this run's isolated fixture, even if bootstrap partially succeeded.
  const identity = userId ? { id: userId } : { email };
  const fixture = await db.user.findUnique({
    where: identity,
    include: { memberships: true },
  });
  if (fixture) {
    organizationId ??= fixture.memberships[0]?.organizationId;
    await db.auditEvent.deleteMany({ where: { actorUserId: fixture.id } });
    await db.securityEvent.deleteMany({ where: { userId: fixture.id } });
    await db.session.deleteMany({ where: { userId: fixture.id } });
    await db.membership.deleteMany({ where: { userId: fixture.id } });
    await db.user.delete({ where: { id: fixture.id } });
    if (organizationId)
      await db.organization.delete({ where: { id: organizationId } });
  }
  await db.$disconnect();
}
