-- Keep existing OWNER memberships aligned with the official RBAC bootstrap.
INSERT INTO `Permission` (`id`, `code`)
VALUES (UUID(), 'providers.manage'), (UUID(), 'providers.simulate')
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT role.`id`, permission.`id`
FROM `Role` AS role
JOIN `Permission` AS permission
  ON permission.`code` IN ('providers.manage', 'providers.simulate')
WHERE role.`code` = 'OWNER';
