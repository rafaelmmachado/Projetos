# CRM ARQ Mídia

CRM ligado ao WhatsApp e à API de Conversões do Meta.

- **Conexão pelo QR code** (padrão, igual ao Trizup): em Rastreamento aparece o QR. No celular: WhatsApp Business > Dispositivos conectados > Conectar dispositivo.
- **Só quem vem do anúncio do Meta** vira lead e recebe a boas-vindas e os follow-ups automáticos. Conversa comum (amigo, cliente antigo) fica de fora. Para mudar: `AUTO_ONLY_META=false`.
- Quem chega com código no texto (`[IG]` da bio, `[IND-NOME]` de indicação, `[SITE]`) vira lead, sem mensagem automática.
- **Formulário do site**: envie (POST, JSON ou form) para `/lead` os campos `nome`, `whatsapp`, `empresa`, `servico` e os `utm_*`, `gclid`, `fbclid` do link. O CRM marca Google Ads, Meta, Instagram ou Site sozinho. Campo opcional `redirect` leva a pessoa pra uma página de obrigado.
- **O CRM não fala com o Meta.** Só o **Trackeamento** manda os eventos do funil, pelo **Pixel + token** que você cola na tela (igual ao Trizup): LeadSubmitted, QualifiedLead, AddToCart, InitiateCheckout, Purchase, só para leads do anúncio do Meta. Tem botão de evento de teste.
- Se o lead responder, os follow-ups automáticos dele param. Entre um envio e outro tem intervalo e "digitando...".

**Risco do QR code:** não é a API oficial. O WhatsApp pode banir o número se houver muito envio, envio pra quem não chamou ou muitas denúncias. Isso afeta só o número; leads e funil continuam salvos aqui.

## Rodar

Node 20+. `npm install` e `node server.js`, depois abra `http://localhost:3000`.

## Variáveis

| Variável | O que é |
|---|---|
| `CRM_PASSWORD` | Senha pra abrir o CRM (o usuário pode ser qualquer um) |
| `MONGODB_URI` | Endereço do banco MongoDB (Atlas grátis). Com ele, leads e sessão do WhatsApp ficam no banco e sobrevivem a reinícios. Sem ele, ficam em arquivos |
| `DATA_DIR` | Pasta dos dados e da sessão do WhatsApp (no Render: `/var/data`, com disco) |
| `AUTO_ONLY_META` | `false` para mandar automação pra todo mundo que chamar. Padrão: só anúncio do Meta |
| `META_DATASET_ID` / `META_CAPI_TOKEN` | Opcional. O normal é colar o Pixel e o token na tela Trackeamento; estas variáveis só servem de padrão |

Modo API oficial (opcional, em vez do QR): `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_ACCOUNT_ID`, `WA_VERIFY_TOKEN`, `META_APP_SECRET`, `WA_TEMPLATE`. Com `WA_TOKEN` preenchido, o CRM usa a API oficial e ignora o QR.

## Render (grátis)

1. MongoDB Atlas grátis (M0): crie um usuário do banco, libere o acesso de qualquer IP (0.0.0.0/0) e copie o endereço `mongodb+srv://...`.
2. Render > New > Web Service > repositório Projetos. Root Directory `arq-crm-server`, Build `npm install`, Start `node server.js`, plano Free.
3. Variáveis: `MONGODB_URI` (o endereço do Atlas) e `CRM_PASSWORD`.
4. O CRM se visita a cada 10 min (usando `RENDER_EXTERNAL_URL`, que o Render preenche sozinho) pra não dormir.
