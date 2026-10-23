-- Per-user read checkpoints. No historical messages or delivery receipts are rewritten.
CREATE TABLE `ConversationReadState` (
  `organizationId` CHAR(36) NOT NULL,
  `conversationId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `readThroughSequence` BIGINT NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ConversationReadState_organizationId_userId_idx`(`organizationId`, `userId`),
  PRIMARY KEY (`organizationId`, `conversationId`, `userId`),
  CONSTRAINT `ConversationReadState_organizationId_conversationId_fkey`
    FOREIGN KEY (`organizationId`, `conversationId`)
    REFERENCES `Conversation`(`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ConversationReadState_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
