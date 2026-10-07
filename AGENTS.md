# Instruções para agentes e Codex

Leia antes de modificar este repositório:

1. README.md
2. docs/ARCHITECTURE.md
3. docs/DOMAIN.md
4. docs/FEATURES.md
5. docs/MILESTONES.md
6. docs/STATUS.md

## Regras

- Trabalhe somente no milestone explicitamente solicitado.
- Não implemente automaticamente itens de milestones posteriores.
- Não altere decisões arquiteturais sem documentar a necessidade.
- Não acople regras de negócio a nomes de planos.
- Não coloque role ou organizationId global em User.
- Não confie em organizationId recebido do frontend sem Membership ativa.
- Não exponha erros de Prisma/ORM, stack traces, tokens ou segredos nas respostas da API.
- Não introduza microserviços sem decisão arquitetural aprovada.
- Controllers devem ser finos; regras ficam em services/use cases/domínio.
- Mudanças de banco devem usar migrations versionadas.
- Toda ação sensível deve considerar auditoria.
- Toda feature protegida comercialmente deve ser verificada no backend.
- Dados de Organizations diferentes nunca podem ser misturados.

## Definition of Done

Uma tarefa só está concluída quando:
- código implementado;
- testes pertinentes passam;
- lint/typecheck/build passam quando existentes;
- migrations estão consistentes;
- documentação afetada foi atualizada;
- docs/STATUS.md reflete o novo estado;
- nenhum segredo foi commitado.

## Commits

Preferir commits pequenos e descritivos.

Exemplos:
- `feat(auth): add global user login`
- `feat(organizations): add membership context`
- `fix(tenancy): enforce organization scope`
- `docs(status): mark membership context complete`
