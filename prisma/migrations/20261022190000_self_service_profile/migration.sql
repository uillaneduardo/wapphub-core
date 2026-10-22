-- Optional per-organization alias; global User.name remains the fallback.
ALTER TABLE `Membership` ADD COLUMN `displayName` VARCHAR(80) NULL;
-- Immutable display identity for new outbound/internal messages.
ALTER TABLE `Message` ADD COLUMN `senderDisplayName` VARCHAR(80) NULL;
