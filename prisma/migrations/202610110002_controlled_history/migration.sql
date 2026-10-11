ALTER TABLE `ProviderConnection` ADD COLUMN `historyOperation` JSON NULL;
ALTER TABLE `ProviderCommand` ADD COLUMN `payload` JSON NULL;
