# Status de Implementação

Atualizar este arquivo em todo PR/entrega que altere o estado funcional do projeto.

Legenda:
- ✅ Implementado e validado
- 🟡 Em andamento
- ⬜ Planejado
- ⛔ Fora do escopo atual

## Estado geral

**Milestone ativo:** M0 — Fundação  
**Estado:** M0 implementado e validado no homelab via Docker Compose.
Escopo conferido com `prompts/M0_FOUNDATION.md` e issue #1. Evidências em
`docs/M0_VALIDATION.md`; nenhum item de M1+ implementado.

## Documentação arquitetural

| Documento | Estado |
|---|---:|
| Arquitetura geral | ✅ |
| Modelo de domínio | ✅ |
| Features/Entitlements | ✅ |
| Realtime/Disponibilidade | ✅ |
| Integração Meta por Organization | ✅ |
| Diagnóstico/Capabilities | ✅ |
| Segurança/Privacidade/LGPD baseline | ✅ |
| API/Clientes/Android futuro | ✅ |
| Performance baseline | ✅ |
| Milestones | ✅ |

## M0 — Fundação

| Item | Estado | Evidência |
|---|---:|---|
| Estrutura de código do Core | ✅ | src/http, application, domain, infrastructure, realtime |
| Runtime/TypeScript | ✅ | Node 22; lint/typecheck/build em container |
| Prisma/MariaDB | ✅ | 2 migrations aplicadas; migrate status e diff sem divergência |
| Redis | ✅ | Readiness e rate limiting autenticado testados |
| User | ✅ | Identidade global; bootstrap/login sem role/Organization globais |
| Organization | ✅ | Bootstrap, listagem e troca de contexto via HTTP |
| Membership | ✅ | Vínculo ativo e permissions revalidados; testes negativos |
| Invitation — persistência M0 | ✅ | FK do autor/token único testados; aceite comercial pertence ao M2 |
| RBAC | ✅ | Role/Permission/RolePermission; organization.read; negação sem permission |
| Autenticação | ✅ | Login scrypt; anti-enumeração; User inativo negado |
| Sessão revogável | ✅ | Hash persistido; logout/relogin/expiração testados |
| Organization Context | ✅ | Seleção/troca/negativas; contexto não autoriza por si só |
| SecurityEvent | ✅ | Login sucesso/falha e revogação persistidos/testados |
| Rate limiting auth | ✅ | Redis; 11ª tentativa/minuto retorna 429 |
| CSRF/CORS/security headers | ✅ | Origin exato + token por sessão; testes de cookies/headers/negação |
| Error handling | ✅ | Erros de validação/infra/payload; nenhuma exceção interna na API |
| AuditEvent | ✅ | Bootstrap/contexto; verificação tenant-scoped |
| Segredos/criptografia base | ✅ | AES-256-GCM versionado; AAD tenant; testes de adulteração |
| Testes multi-tenant | ✅ | A/B, Membership/Organization inativas, permission e contexto forjado |
| /api/v1 | ✅ | 8 endpoints M0 + documento OpenAPI |
| OpenAPI inicial | ✅ | docs/openapi.json coincide com API em execução |
| Contrato realtime inicial | ✅ | Envelope reservado/documentado; nenhum evento ou WebSocket operacional |
| Estrutura API/Worker | ✅ | Mesma imagem; containers separados e saudáveis |

Validação: **25 testes passaram**, lint/typecheck/build passaram, smoke HTTP com
bootstrap administrativo passou, quatro containers saudáveis, health/readiness
HTTP 200, migrations consistentes e revisão de logs/segredos concluída.
Execução reproduzível: `docs/LOCAL_DEVELOPMENT.md`. Nenhuma pendência obrigatória
dentro do escopo M0 solicitado. O fluxo de convites condicionado a assentos,
Chat/WebSocket, catálogo/entitlements, Meta e mídia permanecem nos milestones
posteriores; o estado acima não declara essas funcionalidades implementadas.

## Funcionalidades posteriores

| Domínio | Estado |
|---|---:|
| Chat operacional realtime | ⬜ |
| Entitlements | ⬜ |
| WappHub Admin | ⬜ |
| Minha Conta | ⬜ |
| Meta por Organization | ⬜ |
| Diagnóstico de integração | ⬜ |
| Imagem/áudio | ⬜ |
| Performance 100 agentes | ⬜ |
| MVP comercial | ⬜ |
| Android nativo | ⛔ Pós-MVP |

## Regra de atualização

Não marcar como ✅ apenas porque:
- schema foi criado;
- tela foi desenhada;
- endpoint existe sem regra completa;
- código foi gerado mas não validado.

✅ significa implementado, testado conforme critério do milestone e integrado ao fluxo esperado.
