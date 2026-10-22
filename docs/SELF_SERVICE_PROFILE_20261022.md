# Perfil pessoal e identidade de atendimento — 22/10/2026

## Limite e contrato

Esta entrega adiciona edição do nome da conta e apelido por organização, com consulta implícita no bootstrap de sessão. **Não** modifica e-mail/senha, convites, RBAC, Provider/QR, sincronização, mídia ou funcionalidades comerciais.

### Identidades

- `User.name` continua sendo o nome cadastral global. `User.email` permanece somente leitura; sua alteração requer um fluxo próprio com verificação de propriedade.
- `Membership.displayName` é um override opcional do próprio usuário **somente na organização atualmente selecionada**. `null` significa usar `User.name`. O effectiveDisplayName é sempre calculado no backend; não existe role/organization global no usuário.
- `Message.senderDisplayName` é snapshot imutável de novos envios internos, Demo e WhatsApp Web. O Core usa esse mesmo nome na assinatura externa do WhatsApp, gerada no momento de enfileirar, mantendo `transmittedBody` já persistido para retentativas idempotentes. Envios antigos não recebem backfill; em mensagens legadas a UI segue usando `User.name` para fallback.
- O nome é atualizado no diretório da equipe, na seleção de atendentes e no cabeçalho de autoria da mensagem. Permissões, identidade técnica do canal e autenticação não se alteram.

### API

Todas as rotas estão na versão `/api/v1`. `PATCH` exige sessão autenticada, `Origin` permitido e `x-csrf-token`.

| Método | Rota | Corpo | Resposta |
| --- | --- | --- | --- |
| PATCH | `/me/profile` | `{ "name": "Ana Costa" }` | `{ id, name, email }` |
| PATCH | `/me/organization-profile` | `{ "displayName": "Ana • Vendas" }` ou `{ "displayName": null }` | `{ displayName, effectiveDisplayName }` |
| GET | `/app/bootstrap` | — | `membership.displayName` e `membership.effectiveDisplayName` adicionados |
| POST | `/session/organization` | `{ organizationId }` | mesmos campos adicionados em `membership` |

Os campos de nome são normalizados (Unicode NFC, whitespace) e validados para impedir caracteres de formatação e controles. Limites: conta 120 caracteres, apelido 80. Não há permissão administrativa necessária para editar a própria identidade. A atualização de apelido exige Membership ACTIVE e Organization ACTIVE, sem aceitar organizationId arbitrário; a modificação é limitada ao usuário autenticado e ao contexto da sessão. Alterações geram SecurityEvent/AuditEvent sem dados sensíveis.

### Persistência

Migration `20261022190000_self_service_profile`: adiciona duas colunas opcionais e não altera valores existentes. Não se deve executar `prisma db push` em produção. A migration precisa ser aplicada **antes** de subir a nova API/Worker. Não remover colunas no rollback imediato; o schema anterior ignora as colunas aditivas.

### Entrega e verificação

- Estado: **branch em revisão; sem merge e sem deploy**. Testes foram adicionados, mas ainda dependem de execução em ambiente com MariaDB/Redis e dependências do projeto.
- Gates: `npm ci`, `npm run db:generate`, `npm run db:migrate` (banco de teste), `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run openapi:validate` e `npm run db:validate-drift`; preservar evidências. `docs/openapi.json` foi atualizado a partir dos schemas das rotas e deve ser reconciliado pelo gerador se houver diferença.
- Publicação após PRs aprovadas, backup/restauração verificados e migração: Core+Worker primeiro, Chat depois. A alteração do apelido deve refletir a próxima mensagem para uma conversa controlada e preservar a assinatura de envios já enfileirados ou enviados. Homologar manualmente no notebook em organizações diferentes.
- Rollback: reverter imagens Chat/Core em conjunto, preservar a migration aditiva e dados, nunca resetar WhatsApp/QR, mensagens ou credenciais.
