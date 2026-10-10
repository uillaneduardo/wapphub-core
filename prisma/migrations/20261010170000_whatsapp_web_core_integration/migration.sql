-- AlterTable
ALTER TABLE `Message` ADD COLUMN `providerOccurredAt` DATETIME(3) NULL,
    ADD COLUMN `transmittedBody` TEXT NULL;

-- CreateTable
CREATE TABLE `ProviderConnection` (
    `organizationId` CHAR(36) NOT NULL,
    `channelId` CHAR(36) NOT NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'DISCONNECTED',
    `version` INTEGER NOT NULL DEFAULT 1,
    `providerRevision` INTEGER NOT NULL DEFAULT 0,
    `qrRevision` INTEGER NOT NULL DEFAULT 0,
    `lastCheckedAt` DATETIME(3) NULL,
    `errorCode` VARCHAR(80) NULL,
    `leaseToken` CHAR(36) NULL,
    `leaseUntil` DATETIME(3) NULL,

    INDEX `ProviderConnection_leaseUntil_idx`(`leaseUntil`),
    PRIMARY KEY (`organizationId`, `channelId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderCommand` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `channelId` CHAR(36) NOT NULL,
    `actorUserId` CHAR(36) NOT NULL,
    `sessionId` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `errorCode` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProviderCommand_organizationId_channelId_status_nextAttemptA_idx`(`organizationId`, `channelId`, `status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderInbox` (
    `organizationId` CHAR(36) NOT NULL,
    `channelId` CHAR(36) NOT NULL,
    `deduplicationId` CHAR(64) NOT NULL,
    `eventId` CHAR(36) NOT NULL,
    `correlationId` CHAR(36) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `dataHash` CHAR(64) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProviderInbox_organizationId_channelId_receivedAt_idx`(`organizationId`, `channelId`, `receivedAt`),
    PRIMARY KEY (`organizationId`, `channelId`, `deduplicationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProviderConnection` ADD CONSTRAINT `ProviderConnection_organizationId_channelId_fkey` FOREIGN KEY (`organizationId`, `channelId`) REFERENCES `Channel`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderCommand` ADD CONSTRAINT `ProviderCommand_organizationId_channelId_fkey` FOREIGN KEY (`organizationId`, `channelId`) REFERENCES `ProviderConnection`(`organizationId`, `channelId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderInbox` ADD CONSTRAINT `ProviderInbox_organizationId_channelId_fkey` FOREIGN KEY (`organizationId`, `channelId`) REFERENCES `ProviderConnection`(`organizationId`, `channelId`) ON DELETE RESTRICT ON UPDATE CASCADE;

