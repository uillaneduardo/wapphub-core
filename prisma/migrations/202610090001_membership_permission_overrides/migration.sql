ALTER TABLE `Membership` ADD COLUMN `permissionVersion` INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX `Membership_organizationId_id_key` ON `Membership`(`organizationId`, `id`);
CREATE TABLE `MembershipPermissionOverride` (
  `organizationId` CHAR(36) NOT NULL,
  `membershipId` CHAR(36) NOT NULL,
  `permissionId` CHAR(36) NOT NULL,
  `effect` ENUM('GRANT', 'REVOKE') NOT NULL,
  PRIMARY KEY (`organizationId`, `membershipId`, `permissionId`),
  INDEX `MembershipPermissionOverride_permissionId_idx` (`permissionId`),
  CONSTRAINT `MembershipPermissionOverride_organizationId_membershipId_fkey` FOREIGN KEY (`organizationId`, `membershipId`) REFERENCES `Membership` (`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MembershipPermissionOverride_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `AuditEvent` ADD COLUMN `targetMembershipId` CHAR(36) NULL, ADD COLUMN `details` JSON NULL;
INSERT INTO `Permission` (`id`, `code`) VALUES (UUID(), 'team.read'), (UUID(), 'team.permissions.manage');
INSERT INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.id, p.id FROM `Role` r CROSS JOIN `Permission` p
WHERE (r.code IN ('OWNER', 'SUPERVISOR') AND p.code = 'team.read') OR (r.code = 'OWNER' AND p.code = 'team.permissions.manage');
