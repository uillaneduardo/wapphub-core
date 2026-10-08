import type { Prisma } from "@prisma/client";
import { chatPermissions, agentPermissions } from "../domain/chat.js";
/** Explicit administrative bootstrap only; requests authorize permission codes. */
export async function installChatRBAC(tx: Prisma.TransactionClient) {
  for (const code of ["OWNER", "SUPERVISOR", "AGENT"]) {
    const role = await tx.role.upsert({
      where: { code },
      create: { code },
      update: {},
    });
    const permissions = [
      "organization.read",
      ...(code === "AGENT" ? agentPermissions : chatPermissions),
      ...(code === "OWNER" ? ["providers.manage", "providers.simulate"] : []),
    ];
    for (const code of permissions) {
      const permission = await tx.permission.upsert({
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
  }
}
