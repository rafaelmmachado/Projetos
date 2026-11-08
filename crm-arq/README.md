# CRM · ARQ Mídia

CRM simples para acompanhar os leads da agência, do primeiro contato até o fechamento.

## O que tem

- **Funil (kanban):** Novo lead → Contato feito → Diagnóstico/Reunião → Proposta enviada → Negociação → Fechado / Perdido. Arraste os cards entre as etapas (no celular, use o seletor "Mover" em cada card).
- **Indicadores:** leads em aberto, valor em proposta/negociação, clientes fechados, receita mensal fechada, taxa de fechamento e follow-ups atrasados.
- **Follow-ups:** lista de atrasados, de hoje e próximos, com botão de WhatsApp e "Feito" (registra o contato e agenda o próximo para 2 dias depois).
- **Ficha do lead:** contato, empresa, segmento, WhatsApp, Instagram, cidade, origem, plano, valor mensal, próximo follow-up, motivo da perda e histórico de interações.
- **Lista:** tabela ordenável por qualquer coluna.
- **Busca e filtros** por origem e plano.
- **Exportar CSV** (abre no Excel/Google Sheets), **backup e restauração** em JSON.

## Como usar

Abra o `index.html` no navegador, ou publique pelo GitHub Pages:
Settings → Pages → Source: *Deploy from a branch* → branch `main`, pasta raiz → o CRM fica em `https://<usuario>.github.io/<repositorio>/crm-arq/`.

## Onde ficam os dados

Os leads ficam salvos **no navegador** (localStorage), sem servidor. Isso quer dizer:

- Cada navegador/aparelho tem os seus próprios dados.
- Limpar os dados do navegador apaga os leads — use **⋯ → Baixar backup** de vez em quando.
- Para levar os leads para outro aparelho: baixe o backup em um e use **Restaurar backup** no outro.

## Personalizar

No começo do `app.js` estão as listas de etapas, origens, planos e motivos de perda — é só editar.
