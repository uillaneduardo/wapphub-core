# ADR — consolidação aprovada B1–B4

Decisão aprovada na revisão do PR25 em 2026-10-11. Texto, imagem, áudio/voz e vídeo integram esta consolidação; chamadas, grupos, Status, campanhas e billing permanecem fora do escopo. Atualiza a exclusão de vídeo dos documentos antigos de MVP.

Reutilizar ProviderCommand como outbox, ProviderInbox, sync.batch e vault AES-GCM; sem novo banco/fila/framework. Capacidades de saída/mídia requerem flags técnicas (default false), autorização persistida na conexão e RBAC. UNKNOWN nunca autoriza retry automático. SDK retornar ID não confirma entrega.

Mídia: referência privada no vault e cache limitado criptografado no Provider; Core autoriza bytes por mensagem/visibilidade. Download sob demanda, nunca URLs/chaves no Chat. Limites por tipo, TTL e pressão são técnicos. Nenhuma migração/deploy produtivo nesta execução.

Histórico bootstrap entregue: cursor durável e ciclos de processamento local, separados da quota ON_DEMAND e sem teto permanente por conta de 500/500/1000. Byte limits permanecem para rejeitar arquivos inseguros. Não pedir dados novos no restart/deploy.
