import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { installChatRBAC } from "../src/application/chat-rbac.js";

if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Provider RBAC tests require an isolated _test database");

const db = new PrismaClient();
test("only the owner bootstrap grants Demo provider administration/simulation permissions", async () => {
  await db.$transaction((tx) => installChatRBAC(tx));
  const roles = await db.role.findMany({
    where: { code: { in: ["OWNER", "SUPERVISOR", "AGENT"] } },
    include: { permissions: { include: { permission: true } } },
  });
  const permissions = new Map(roles.map((role) => [role.code, role.permissions.map((row) => row.permission.code)]));
  assert.ok(permissions.get("OWNER")?.includes("providers.manage"));
  assert.ok(permissions.get("OWNER")?.includes("providers.simulate"));
  assert.ok(!permissions.get("SUPERVISOR")?.includes("providers.manage"));
  assert.ok(!permissions.get("AGENT")?.includes("providers.simulate"));
  await db.$disconnect();
});
