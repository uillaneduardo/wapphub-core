# Prompts de Implementação

Este diretório contém prompts versionados para execução controlada por Codex/agents.

## Regras

- Cada prompt corresponde a um milestone ou tarefa claramente delimitada.
- Antes de executar um prompt, o agente deve ler `AGENTS.md` e toda a documentação referenciada.
- O prompt não substitui a documentação do projeto; ele apenas define a tarefa a executar.
- O agente não deve implementar milestones futuros sem instrução explícita.
- O agente deve atualizar `docs/STATUS.md` apenas para itens realmente implementados e validados.
- Prompts concluídos permanecem versionados para histórico e auditoria.

## Convenção de nomes

Exemplos:

- `M0_FOUNDATION.md`
- `M1_CHAT_INTERNAL.md`
- `M2_ENTITLEMENTS.md`

## Fluxo recomendado no homelab

```bash
cd ~/homelab/apps/wapphub-core
git pull
codex
```

Dentro do Codex:

```
Leia AGENTS.md e depois leia prompts/M0_FOUNDATION.md.
Execute exatamente o escopo definido nesse prompt.
```
