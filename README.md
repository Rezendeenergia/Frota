# Painel TV — Rezende Energia

Tela para TV (modo kiosk) com indicadores de **manutenção da frota**, **abastecimento** e, futuramente, **estoque de combustível por localidade**. Atualiza os dados a cada 30 minutos.

Segue a mesma arquitetura do CromFolgas: um serviço Node/Express que busca os dados em segundo plano, guarda em cache, e serve uma página estática que a TV mantém aberta o dia todo.

## Estrutura

```
painel-tv/
├── server/
│   ├── index.js                 # Express: cache, /api/painel, serve o front
│   └── lib/
│       ├── sharepoint.js        # Auth Microsoft Graph (mesmo padrão do CromFolgas)
│       ├── formatters.js        # Parsing de moeda/data em pt-BR
│       ├── manutencaoService.js # Lê e agrega a planilha de manutenção
│       ├── abastecimentoService.js # Consome o endpoint /api/painel-tv do sistema de abastecimento
│       └── estoqueService.js    # Placeholder (estoque por localidade — futuro)
├── public/
│   ├── index.html               # Tela da TV (dark, 3 colunas)
│   └── app.js                   # Busca /api/painel e renderiza
├── package.json
└── render.yaml
```

## Como os dados chegam na tela

1. **Manutenção**: lê `MANUTENÇÕES REZENDE ENERGIA.xlsx` direto do SharePoint via Microsoft Graph (client-credentials — sem login interativo), mesma credencial de app já usada pelo CromFolgas.
2. **Abastecimento**: consome um endpoint que **você** (TI) vai expor no app de abastecimento (`abast-56aa.onrender.com`), protegido por API key. O contrato exato está documentado em `server/lib/abastecimentoService.js` — resumo abaixo.
3. **Estoque por localidade**: ainda não existe fonte. O card já aparece na tela como "Em breve" e não precisa de nenhuma mudança de código quando a fonte existir — só trocar o corpo de `fetchEstoque()`.

Se qualquer uma das três fontes falhar, as outras duas continuam aparecendo normalmente (cada uma degrada de forma independente).

## Contrato do endpoint de abastecimento

Implemente no app de abastecimento:

```
GET /api/painel-tv
Header: X-API-Key: <mesma chave que você vai colocar em ABASTECIMENTO_API_KEY>

200 OK:
{
  "geradoEm": "2026-09-08T12:00:00.000Z",
  "periodo": "últimos 7 dias",
  "totalLitros": 4230.5,
  "custoTotal": 25120.30,
  "qtdAbastecimentos": 58,
  "pendentesAprovacao": 3,
  "porPosto":   [ { "chave": "Posto Central", "litros": 1800, "custo": 10800 } ],
  "porVeiculo": [ { "chave": "QCP2G44 · Ranger", "litros": 320, "custo": 1920 } ],
  "bombonas":   [ { "nome": "Bombona Norte", "litrosRestantes": 1200, "capacidade": 5000 } ]
}
```

Qualquer campo que ainda não exista pode vir `null`/`0`/`[]` — a tela já lida com isso sem quebrar o layout. Enquanto esse endpoint não estiver pronto, a coluna de abastecimento mostra "Integração em configuração" — a tela funciona normalmente só com manutenção.

## Deploy no Render

### 1. Criar o serviço

- No Render, **New → Web Service**, aponte para este código (repositório Git ou upload manual).
- Runtime: **Node**. Build command: `npm install`. Start command: `npm start`.
- Ou simplesmente use o `render.yaml` incluído (Render detecta e cria o serviço automaticamente via "Blueprint").

### 2. Variáveis de ambiente

No painel do serviço `painel-tv-rezende` → **Environment**:

| Variável | De onde vem |
|---|---|
| `SHAREPOINT_CLIENT_ID` | Copie do serviço `cromfolgas` existente no Render (mesma App Registration do Azure) |
| `SHAREPOINT_CLIENT_SECRET` | Idem |
| `SHAREPOINT_TENANT_ID` | Idem |
| `ABASTECIMENTO_API_URL` | URL completa do novo endpoint, ex.: `https://abast-56aa.onrender.com/api/painel-tv` |
| `ABASTECIMENTO_API_KEY` | Uma chave nova que você gera e configura **igual** nos dois lados (aqui e no app de abastecimento) |

Para gerar uma chave de API razoável, qualquer string aleatória longa serve, por exemplo via terminal:

```bash
openssl rand -hex 32
```

Até você configurar `ABASTECIMENTO_API_URL`/`ABASTECIMENTO_API_KEY`, o painel funciona normalmente mostrando só manutenção — não precisa esperar o abastecimento ficar pronto para colocar isso no ar.

### 3. Testar antes de apontar a TV

Depois do deploy, abra a URL do serviço (ex.: `https://painel-tv-rezende.onrender.com`) num navegador comum primeiro, confira se os 3 cards aparecem corretamente, e só depois configure a TV.

**Importante**: não consegui rodar `npm install`/`npm start` neste ambiente (o registro do npm bloqueou a instalação aqui), então o código não foi testado em execução — só revisado manualmente e validado contra os totais já conferidos da planilha (custo confirmado, tempo médio parado etc. batem com o cálculo feito em Python/pandas durante a análise). Recomendo rodar `npm install && npm start` localmente (ou simplesmente observar o primeiro deploy no Render) antes de deixar a TV ligada nela.

### 4. Configurar a TV

Qualquer TV com um navegador (Smart TV, Chromecast com Chrome, mini-PC, Fire TV Stick com navegador) ou um Chrome em modo kiosk apontando para a URL do serviço:

```bash
chrome --kiosk --incognito https://painel-tv-rezende.onrender.com
```

A página já se atualiza sozinha (busca novos dados a cada 5 min, dados em si só mudam a cada 30 min) e recarrega inteira a cada 6h por segurança — não precisa mexer em nada depois de configurada.

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha as credenciais
npm start
# abre em http://localhost:3000
```

## Plano free do Render — atenção

Se o serviço for criado no plano **free**, ele "dorme" após um período sem acessos, e o primeiro acesso depois disso demora alguns segundos para acordar. Para uma TV ligada o dia todo, isso não chega a ser um problema real (a própria TV mantém o acesso vivo a cada 5 min), mas se notar a tela "travando" ao acordar, considere migrar para um plano pago.
