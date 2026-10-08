import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/infrastructure/crypto.js";
const db = new PrismaClient();
async function main() {
  const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_PASSWORD;
  const name = process.env.BOOTSTRAP_ORGANIZATION;
  if (!email || !password || password.length < 12 || !name)
    throw new Error("Invalid bootstrap input");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const permission = await tx.permission.upsert({
      where: { code: "organization.read" },
      create: { code: "organization.read" },
      update: {},
    });
    for (const code of ["OWNER", "SUPERVISOR", "AGENT"]) {
      const role = await tx.role.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      await tx.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
    const role = await tx.role.findUniqueOrThrow({ where: { code: "OWNER" } });
    // Explicit provisioning only; existing identities are never overwritten.
    const user = await tx.user.create({
      data: {
        email,
        name: process.env.BOOTSTRAP_NAME ?? "Owner",
        passwordHash,
      },
    });
    const organization = await tx.organization.create({ data: { name } });
    await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        roleId: role.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: organization.id,
        actorUserId: user.id,
        action: "FOUNDATION_BOOTSTRAP",
      },
    });
  });
  process.stdout.write("Bootstrap completed\n");
}
try {
  await main();
} catch {
  process.stderr.write(
    "Bootstrap failed; verify input and existing identity\n",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
