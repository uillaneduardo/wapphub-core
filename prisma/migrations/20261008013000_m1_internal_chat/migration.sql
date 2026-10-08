-- CreateTable
CREATE TABLE `Contact` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `primaryIdentifier` VARCHAR(254) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Contact_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `Contact_organizationId_primaryIdentifier_key`(`organizationId`, `primaryIdentifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `contactId` CHAR(36) NOT NULL,
    `status` ENUM('OPEN', 'PENDING', 'ARCHIVED') NOT NULL DEFAULT 'OPEN',
    `assignedUserId` CHAR(36) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `visibility` ENUM('FULL', 'LIMITED', 'NONE') NOT NULL DEFAULT 'FULL',
    `visibleFromMessage` BIGINT NOT NULL DEFAULT 0,
    `visibleFromEvent` BIGINT NOT NULL DEFAULT 0,

    INDEX `Conversation_organizationId_status_lastMessageAt_id_idx`(`organizationId`, `status`, `lastMessageAt`, `id`),
    INDEX `Conversation_organizationId_assignedUserId_lastMessageAt_id_idx`(`organizationId`, `assignedUserId`, `lastMessageAt`, `id`),
    UNIQUE INDEX `Conversation_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` CHAR(36) NOT NULL,
    `sequence` BIGINT NOT NULL AUTO_INCREMENT,
    `organizationId` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `senderUserId` CHAR(36) NULL,
    `clientMessageId` VARCHAR(100) NULL,
    `direction` VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
    `type` VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    `body` TEXT NULL,
    `status` ENUM('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED') NOT NULL DEFAULT 'SENT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Message_sequence_key`(`sequence`),
    INDEX `Message_organizationId_conversationId_sequence_idx`(`organizationId`, `conversationId`, `sequence`),
    UNIQUE INDEX `Message_organizationId_conversationId_clientMessageId_key`(`organizationId`, `conversationId`, `clientMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tag_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `Tag_organizationId_name_key`(`organizationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationTag` (
    `organizationId` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `tagId` CHAR(36) NOT NULL,

    INDEX `ConversationTag_organizationId_tagId_conversationId_idx`(`organizationId`, `tagId`, `conversationId`),
    PRIMARY KEY (`organizationId`, `conversationId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InternalNote` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `authorUserId` CHAR(36) NOT NULL,
    `body` TEXT NOT NULL,
    `eventSequence` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InternalNote_organizationId_conversationId_eventSequence_idx`(`organizationId`, `conversationId`, `eventSequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationAssignmentHistory` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NOT NULL,
    `actorUserId` CHAR(36) NOT NULL,
    `fromUserId` CHAR(36) NULL,
    `toUserId` CHAR(36) NOT NULL,
    `visibility` ENUM('FULL', 'LIMITED', 'NONE') NOT NULL,
    `lastN` INTEGER NULL,
    `visibleFromMessage` BIGINT NOT NULL,
    `note` VARCHAR(2000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConversationAssignmentHistory_organizationId_conversationId__idx`(`organizationId`, `conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RealtimeEvent` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `organizationId` CHAR(36) NOT NULL,
    `type` VARCHAR(80) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `conversationId` CHAR(36) NULL,
    `messageSequence` BIGINT NULL,
    `payload` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RealtimeEvent_organizationId_id_idx`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_organizationId_contactId_fkey` FOREIGN KEY (`organizationId`, `contactId`) REFERENCES `Contact`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_organizationId_conversationId_fkey` FOREIGN KEY (`organizationId`, `conversationId`) REFERENCES `Conversation`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_senderUserId_fkey` FOREIGN KEY (`senderUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationTag` ADD CONSTRAINT `ConversationTag_organizationId_conversationId_fkey` FOREIGN KEY (`organizationId`, `conversationId`) REFERENCES `Conversation`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationTag` ADD CONSTRAINT `ConversationTag_organizationId_tagId_fkey` FOREIGN KEY (`organizationId`, `tagId`) REFERENCES `Tag`(`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalNote` ADD CONSTRAINT `InternalNote_organizationId_conversationId_fkey` FOREIGN KEY (`organizationId`, `conversationId`) REFERENCES `Conversation`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalNote` ADD CONSTRAINT `InternalNote_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationAssignmentHistory` ADD CONSTRAINT `ConversationAssignmentHistory_organizationId_conversationId_fkey` FOREIGN KEY (`organizationId`, `conversationId`) REFERENCES `Conversation`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationAssignmentHistory` ADD CONSTRAINT `ConversationAssignmentHistory_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RealtimeEvent` ADD CONSTRAINT `RealtimeEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

