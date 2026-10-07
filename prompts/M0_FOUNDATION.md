# Prompt oficial — M0 Fundação do WappHub Core

Implemente exclusivamente o milestone **M0 — Fundação do WappHub Core**.

Você está trabalhando diretamente no homelab Linux onde a aplicação será executada.

## Antes de modificar qualquer arquivo

Leia integralmente e trate como fonte oficial:

- `README.md`
- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN.md`
- `docs/FEATURES.md`
- `docs/REALTIME_AVAILABILITY.md`
- `docs/META_INTEGRATION.md`
- `docs/INTEGRATION_DIAGNOSTICS.md`
- `docs/SECURITY_PRIVACY.md`
- `docs/API_CLIENTS.md`
- `docs/PERFORMANCE_BASELINE.md`
- `docs/MILESTONES.md`
- `docs/STATUS.md`

Use também a issue #1 do repositório como referência.

Não implemente funcionalidades pertencentes a M1 ou posteriores.

## Ambiente

O ambiente de desenvolvimento é o próprio homelab.

Não presuma que Node, MariaDB ou Redis estejam instalados diretamente no host se puderem ser executados por Docker.

A aplicação e suas dependências devem ser reproduzíveis via Docker Compose.

## Stack esperada

Use:

- TypeScript;
- Fastify;
- Prisma;
- MariaDB;
- Redis;
- Docker / Docker Compose;
- testes automatizados adequados à stack.

Não altere a stack sem justificar e documentar a decisão.

## Implementar neste milestone

### Fundação técnica

- estrutura modular do backend;
- configuração TypeScript/runtime;
- configuração de lint;
- typecheck;
- build;
- testes;
- configuração por ambiente;
- `.env.example`;
- `.gitignore` apropriado;
- Dockerfile;
- `compose.yml`;
- healthchecks;
- scripts operacionais.

### Persistência

- Prisma;
- MariaDB;
- migrations versionadas;
- seed mínimo apenas se necessário para bootstrap/testes.

### Identidade e tenancy

- User global;
- Organization;
- Membership;
- OrganizationInvitation;
- Role;
- Permission;
- RolePermission.

Não colocar `organizationId` global nem `role` global em `User`.

### Autenticação e sessão

- login;
- logout;
- sessão web server-side revogável;
- armazenamento seguro do identificador/token de sessão;
- cookie seguro conforme documentação;
- recuperação/estrutura necessária para revogação;
- Organization Context;
- seleção/troca de Organization.

`currentOrganizationId` é contexto, não autorização.

Cada operação protegida deve validar Membership ativa.

### Segurança

- rate limiting em autenticação;
- CORS restritivo/configurável;
- CSRF conforme estratégia documentada;
- security headers;
- tratamento seguro de erros;
- sanitização de logs;
- SecurityEvent básico;
- AuditEvent básico;
- proteção contra enumeração óbvia de usuários quando aplicável;
- base para criptografia/proteção de segredos;
- nenhum segredo real versionado.

### Multi-tenancy

Criar testes negativos que comprovem que Organization A não acessa dados de Organization B.

O isolamento multi-tenant é requisito de segurança primário.

### API

A API deve nascer versionada em:

```
/api/v1
```

Criar contrato inicial OpenAPI.

Endpoints mínimos esperados, podendo ser ajustados tecnicamente sem mudar o objetivo:

```
GET  /api/v1/health
GET  /api/v1/health/ready

POST /api/v1/auth/login
POST /api/v1/auth/logout

GET  /api/v1/me
GET  /api/v1/me/organizations

POST /api/v1/session/organization

GET  /api/v1/app/bootstrap
```

Não implementar endpoints de Chat, Meta ou mídia.

### Realtime

Não implementar o Chat realtime ainda.

Apenas preparar a fundação/contrato inicial necessária para M1:
- organização de módulos;
- contrato de eventos;
- estrutura preparada para WebSocket/realtime;
- sem polling;
- sem eventos de conversa/mensagem ainda.

### API + Worker

A estrutura deve permitir processos separados:

- `wapphub-core-api`;
- `wapphub-core-worker`.

Eles podem usar a mesma imagem/base de código.

Não implementar jobs de Meta ainda.

### Redis

Redis deve estar disponível via Docker Compose e ser integrado apenas para responsabilidades coerentes com a documentação.

Não usar Redis como fonte da verdade de domínio.

### Scripts operacionais

Criar scripts simples e seguros, por exemplo:

- subir ambiente;
- parar ambiente;
- ver logs;
- ver status;
- deploy/rebuild local no homelab.

Evitar scripts destrutivos.

## Docker Compose

O ambiente deve fornecer pelo menos:

- `wapphub-core-api`;
- `wapphub-core-worker` ou estrutura equivalente preparada;
- `wapphub-db`;
- `wapphub-redis`.

MariaDB e Redis não devem ser expostos publicamente.

O compose deve usar rede interna apropriada.

## Não implementar neste milestone

Não implementar:

- integração Meta;
- WhatsApp;
- MetaIntegration;
- Channel operacional;
- Conversation;
- Message;
- Contact;
- Media;
- áudio;
- imagem;
- frontend;
- billing;
- entitlements completos;
- Product/Plan/Feature;
- Chat;
- WappHub Platform;
- M1 ou posteriores.

## Validação obrigatória antes de concluir

Antes de considerar o M0 concluído:

1. subir o ambiente com Docker Compose;
2. aguardar MariaDB e Redis ficarem saudáveis;
3. executar migrations;
4. executar lint;
5. executar typecheck;
6. executar testes;
7. executar build;
8. validar `/api/v1/health`;
9. validar `/api/v1/health/ready`;
10. validar conexão com MariaDB;
11. validar conexão com Redis;
12. executar testes de isolamento multi-tenant;
13. revisar logs em busca de segredos ou erros internos expostos;
14. verificar que nenhum segredo real foi commitado;
15. atualizar `docs/STATUS.md` somente para itens realmente implementados e testados.

## Git

Trabalhe somente na branch:

```
feat/m0-foundation
```

Não faça merge na `main`.

Não force push.

Prefira commits pequenos e descritivos.

## Resultado esperado

Ao terminar, apresente um resumo com:

- arquivos principais criados/alterados;
- arquitetura implementada;
- migrations criadas;
- endpoints disponíveis;
- testes executados;
- resultados de lint/typecheck/build;
- estado dos containers;
- healthchecks;
- itens do M0 concluídos;
- itens do M0 ainda pendentes;
- qualquer desvio arquitetural necessário e sua justificativa.

Se algum requisito não puder ser validado no ambiente atual, não marque como concluído no `docs/STATUS.md`.
