# Status de Implementação

Atualizar este arquivo em todo PR/entrega que altere o estado funcional do projeto.

Legenda:
- ✅ Implementado e validado
- 🟡 Em andamento
- ⬜ Planejado
- ⛔ Fora do escopo atual

## Estado geral

**Milestone ativo:** M0 — Fundação  
**Estado:** arquitetura e requisitos pré-implementação consolidados; código funcional ainda não iniciado.

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
| Estrutura de código do Core | ⬜ | — |
| Runtime/TypeScript | ⬜ | — |
| Prisma/MariaDB | ⬜ | — |
| Redis | ⬜ | — |
| User | ⬜ | — |
| Organization | ⬜ | — |
| Membership | ⬜ | — |
| Invitation | ⬜ | — |
| RBAC | ⬜ | — |
| Autenticação | ⬜ | — |
| Sessão revogável | ⬜ | — |
| Organization Context | ⬜ | — |
| SecurityEvent | ⬜ | — |
| Rate limiting auth | ⬜ | — |
| CSRF/CORS/security headers | ⬜ | — |
| Error handling | ⬜ | — |
| AuditEvent | ⬜ | — |
| Segredos/criptografia base | ⬜ | — |
| Testes multi-tenant | ⬜ | — |
| /api/v1 | ⬜ | — |
| OpenAPI inicial | ⬜ | — |
| Contrato realtime inicial | ⬜ | — |
| Estrutura API/Worker | ⬜ | — |

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
