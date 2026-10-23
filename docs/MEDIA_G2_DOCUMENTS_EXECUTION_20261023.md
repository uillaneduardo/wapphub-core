# G.2 — execução integrada de documentos (checkpoint de contrato)

Data: 2026-10-23. Status: **planejado, não implementado**. Dependências: Core #49 e Chat #51. Multi-imagens do Chat PR #58 já integrado separadamente.

## Diagnóstico verificado

- `contracts/provider-media.ts` usa `mediaUploadSchema` com IMAGE/AUDIO/VOICE/VIDEO e `validMediaKind` sem DOCUMENT.
- `MediaUpload` exige `mediaId`, `type`, `mimeType`, `fileName`, `size`, `sha256`; limites atuais de imagem 8 MiB, vídeo 25 MiB e áudio 16 MiB.
- O `README.md` e `AGENTS.md` exigem execução de mudanças inter-repositório no Codex do homelab com auditoria de estado real. Não assumir que `main` equivale ao deploy.
- A implementação de DOCUMENT somente no enum ou no Chat seria insegura e causaria regressões: **não liberar a feature parcialmente**.

## Escopo fechado para implementação

1. **Auditoria A0/A1**: confirmar SHAs/branches reais, `git status`, Compose de Core/Worker e Provider, saúde de filas, armazenamento, OpenAPI, `contracts/provider.ts`, `contracts/provider-media.ts`, esquema Prisma, rotas de upload/media/download, normalizadores do Baileys e capacidades anunciadas ao Chat. Registrar pontos alteráveis e rollback. Respeitar `docs/WHATSAPP_WEB_CONSOLIDATION_EXECUTION.md` e `docs/WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md`.
2. **Contrato A2**: DOCUMENT explícito por capability efetiva do canal, MIME + extensão allowlist e verificação binária dos formatos que possuam assinatura conhecida; PDF, DOC/DOCX, XLS/XLSX, CSV e TXT. Office OpenXML é ZIP e exige inspeção interna segura sem extração indiscriminada; arquivos legados OLE exigem verificação apropriada. Rejeitar ZIP genérico, executáveis, extensões duplas enganosas, nome com path/control e arquivos vazios. Códigos de erro genéricos e estáveis; limite máximo por arquivo decidido conforme upload/WhatsApp/memória reais, sem presumir 25 MiB para todos.
3. **Core/Worker**: autorizar por membership, organização, atribuição/permissões e capability; manter mediaId, hash, metadados sanitizados, expiração, download autenticado e Range quando existente; evitar carregar mídia inteira na RAM. Upload não dispara mensagem; disparo só por ação explícita e clientMessageId idempotente. UNKNOWN nunca provoca retransmissão cega.
4. **Provider Baileys**: mapear send de documento para a API do SDK realmente instalada, com filename preservado dentro do limite; receber documento, normalizar author/metadata/bytes e eventos sem expor raw, URL ou key. Preservar autoria externa, de-dup e status.
5. **Chat**: mostrar DOCUMENT somente quando capability publicada pelo Core; seletor compatível, nome sanitizado legível, tamanho e ícone Lucide; prévia e ação remover antes de envio; estado progresso/erro/retry com suporte a UNKNOWN; download autorizado. Nunca transformar documentos em imagens falsas.
6. **Testes e CI**: unitários e integração dos formatos permitidos, MIME/extensão conflitantes, falso PDF, Office comprimido perigoso, limite/quota, arquivo expirado, download Range, acesso cruzado entre tenants, AGENT sem atribuição, revogação de permissão, falha parcial, duplicação, UNKNOWN, preservação dos testes existentes de imagem/voz/vídeo. `npm ci`, lint, typecheck, testes, build, OpenAPI e migração/drift (se aplicável), para Core, Provider e Chat.
7. **Entrega**: PRs pequenos separados por repositório e CI verde antes de merge. Atualizar progress/status e matriz de homologação. Nunca dar merge em patch que anuncie DOCUMENT antes de estar suportado de ponta a ponta; usar capability desligada até integração real.
8. **Deploy**: após autorização pertinente, executar pelo Codex no homelab. Quando Core mudar, atualizar e conferir **Core + Worker + Provider juntos**, usando os Compose efetivos detectados no host (não inventar comando). Em seguida publicar Chat, verificar health/logs, pareamento/sessão sem novo QR, permissões, envio/recebimento e download em navegador real. Não apagar volumes, não disparar WhatsApp real automaticamente, não presumir sucesso sem evidência.

## Gates de homologação

- [ ] A0/A1 capturados no homelab (SHAs, arquivos Compose, serviços)
- [ ] A2 arquitetura registrada e revisada
- [ ] Core/Provider enviam/recebem DOCUMENT, com testes de tenant e segurança
- [ ] Chat consome capability real e exibe documento
- [ ] CI completo nos componentes alterados
- [ ] Deploy Core + Provider + Chat verificado
- [ ] Testes manuais no celular/notebook homologados pelo usuário

**Observação:** este checkpoint é documentação executável para o fluxo Codex; não altera contratos em runtime, não habilita uploads e não representa G.2 concluída.
