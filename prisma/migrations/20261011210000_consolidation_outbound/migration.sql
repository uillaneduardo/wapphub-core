ALTER TABLE `Message` ADD COLUMN `deliveryOutcome` VARCHAR(20) NULL;
ALTER TABLE `ProviderConnection` ADD COLUMN `outboundEnabled` BOOLEAN NOT NULL DEFAULT false, ADD COLUMN `mediaEnabled` BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE `Media` (
 `id` CHAR(36) NOT NULL, `organizationId` CHAR(36) NOT NULL, `channelId` CHAR(36) NOT NULL, `conversationId` CHAR(36) NOT NULL, `actorUserId` CHAR(36) NOT NULL, `messageId` CHAR(36) NULL,
 `type` VARCHAR(20) NOT NULL, `mimeType` VARCHAR(120) NOT NULL, `fileName` VARCHAR(200) NOT NULL, `size` INTEGER NOT NULL, `sha256` CHAR(64) NOT NULL, `expiresAt` DATETIME(3) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`), UNIQUE INDEX `Media_messageId_key` (`messageId`), INDEX `Media_organizationId_conversationId_expiresAt_idx` (`organizationId`,`conversationId`,`expiresAt`),
 CONSTRAINT `Media_organizationId_channelId_fkey` FOREIGN KEY (`organizationId`,`channelId`) REFERENCES `Channel` (`organizationId`,`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
