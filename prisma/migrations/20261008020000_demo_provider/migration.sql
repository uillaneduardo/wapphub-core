CREATE TABLE `Channel` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `provider` VARCHAR(30) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DISABLED',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Channel_organizationId_id_key` (`organizationId`, `id`),
  UNIQUE INDEX `Channel_organizationId_provider_key` (`organizationId`, `provider`),
  CONSTRAINT `Channel_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ContactIdentity` (
  `organizationId` CHAR(36) NOT NULL,
  `channelId` CHAR(36) NOT NULL,
  `contactId` CHAR(36) NOT NULL,
  `externalId` VARCHAR(120) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`organizationId`, `channelId`, `externalId`),
  UNIQUE INDEX `ContactIdentity_organizationId_channelId_contactId_key` (`organizationId`, `channelId`, `contactId`),
  INDEX `ContactIdentity_organizationId_contactId_idx` (`organizationId`, `contactId`),
  CONSTRAINT `ContactIdentity_channel_fkey` FOREIGN KEY (`organizationId`, `channelId`) REFERENCES `Channel` (`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ContactIdentity_contact_fkey` FOREIGN KEY (`organizationId`, `contactId`) REFERENCES `Contact` (`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Conversation`
  ADD COLUMN `channelId` CHAR(36) NULL,
  ADD COLUMN `providerConversationId` VARCHAR(120) NULL,
  ADD UNIQUE INDEX `Conversation_organizationId_channelId_providerConversationId_key` (`organizationId`, `channelId`, `providerConversationId`),
  ADD CONSTRAINT `Conversation_channel_fkey` FOREIGN KEY (`organizationId`, `channelId`) REFERENCES `Channel` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Message`
  ADD COLUMN `senderContactId` CHAR(36) NULL,
  ADD COLUMN `channelId` CHAR(36) NULL,
  ADD COLUMN `providerMessageId` VARCHAR(160) NULL,
  ADD UNIQUE INDEX `Message_organizationId_channelId_providerMessageId_key` (`organizationId`, `channelId`, `providerMessageId`),
  ADD CONSTRAINT `Message_senderContact_fkey` FOREIGN KEY (`organizationId`, `senderContactId`) REFERENCES `Contact` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Message_channel_fkey` FOREIGN KEY (`organizationId`, `channelId`) REFERENCES `Channel` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
