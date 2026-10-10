-- Existing domain tables; no second contact/message store or historical rewrite.
ALTER TABLE `Contact` ADD COLUMN `providerName` VARCHAR(120) NULL;
ALTER TABLE `Conversation` ADD COLUMN `providerMetadata` JSON NULL,
    ADD COLUMN `historyBoundaryAt` DATETIME(3) NULL;
ALTER TABLE `Message` ADD COLUMN `historical` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mediaMetadata` JSON NULL, ADD COLUMN `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
CREATE INDEX `Message_organizationId_conversationId_createdAt_id_idx`
    ON `Message`(`organizationId`, `conversationId`, `createdAt`, `id`);
ALTER TABLE `ProviderConnection` ADD COLUMN `pairingPhase` VARCHAR(24) NULL,
    ADD COLUMN `providerSync` JSON NULL, ADD COLUMN `syncProgress` JSON NULL,
    ADD COLUMN `pendingReceipts` JSON NULL;
-- Multiple verified external aliases for one internal contact. PK/FKs unchanged.
CREATE INDEX `ContactIdentity_organizationId_channelId_contactId_idx`
    ON `ContactIdentity`(`organizationId`, `channelId`, `contactId`);
DROP INDEX `ContactIdentity_organizationId_channelId_contactId_key` ON `ContactIdentity`;
