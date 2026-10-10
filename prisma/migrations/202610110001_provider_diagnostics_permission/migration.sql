-- Additive permission for existing OWNER administrators; no agent role is expanded.
INSERT INTO `Permission` (`id`, `code`) VALUES (UUID(), 'providers.diagnostics.read')
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT existing.`roleId`, diagnostic.`id`
FROM `RolePermission` existing
JOIN `Permission` management ON management.`id` = existing.`permissionId` AND management.`code` = 'providers.manage'
JOIN `Permission` diagnostic ON diagnostic.`code` = 'providers.diagnostics.read'
JOIN `Role` owner_role ON owner_role.`id` = existing.`roleId` AND owner_role.`code` = 'OWNER';
CREATE INDEX `ProviderInbox_organizationId_channelId_eventId_idx` ON `ProviderInbox` (`organizationId`, `channelId`, `eventId`);
CREATE INDEX `ProviderCommand_organizationId_channelId_createdAt_idx` ON `ProviderCommand` (`organizationId`, `channelId`, `createdAt`);
