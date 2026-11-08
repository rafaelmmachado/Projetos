# CRM ARQ Mídia

CRM ligado ao WhatsApp oficial (Cloud API) e à API de Conversões do Meta.

- Lead manda mensagem → entra sozinho em **01 novo lead**, com a origem identificada (anúncio do Meta, código `[IG]`, `[IND-NOME]`, `[SITE]` ou WhatsApp direto).
- A automação de entrada manda a boas-vindas e os follow-ups pelo seu número. Se o lead responder, os follow-ups automáticos param.
- Cada etapa do funil manda o evento que o Meta reconhece (LeadSubmitted, QualifiedLead, AddToCart, InitiateCheckout, Purchase), quando o lead veio de anúncio de WhatsApp.

Sem dependências: só Node 20+. `node server.js` e abre `http://localhost:3000`.

## Variáveis (no Render, em Environment)

| Variável | O que é |
|---|---|
| `CRM_PASSWORD` | Senha pra abrir o CRM (usuário pode ser qualquer um) |
| `WA_TOKEN` | Token de acesso do app no Meta (WhatsApp > Configuração da API) |
| `WA_PHONE_NUMBER_ID` | ID do número de telefone |
| `WA_BUSINESS_ACCOUNT_ID` | ID da conta do WhatsApp Business |
| `WA_VERIFY_TOKEN` | Uma senha que você inventa e coloca igual no Webhook do Meta |
| `META_APP_SECRET` | Opcional. Chave secreta do app (Configurações > Básico), confere que o webhook veio do Meta |
| `META_DATASET_ID` | Opcional. Dataset da API de Conversões. Sem ele, os eventos ficam "aguardando integração" |
| `WA_TEMPLATE` | Opcional. Modelo aprovado pra mandar depois de 24h sem resposta (ex.: `hello_world`, com `WA_TEMPLATE_LANG=en_US`) |
| `DATA_DIR` | Pasta onde fica o `data.json`. No plano grátis do Render os dados somem quando o servidor reinicia; pra valer, use plano pago com disco e `DATA_DIR=/var/data` |

## Webhook no Meta

App > WhatsApp > Configuração > Webhook:
- URL de callback: `https://SEU-APP.onrender.com/webhook`
- Token de verificação: o mesmo de `WA_VERIFY_TOKEN`
- Depois, em "Campos do webhook", assine **messages**.

## Limites do teste

- O número de teste do Meta só manda pra até 5 números cadastrados em "Para".
- Fora da janela de 24h, o WhatsApp só aceita modelo aprovado (`WA_TEMPLATE`).
- Áudio gravado no Chrome sai em webm; o WhatsApp prefere ogg/opus ou mp3. Se der erro, envie um arquivo mp3.
- O token temporário do painel vence em 24h. Para uso de verdade, gere um token permanente (Usuário do sistema no Business).
