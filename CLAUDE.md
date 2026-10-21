# Frota — Painel TV e Rastreamento da Frota

Dois produtos num serviço só:
1. **Painel TV** (`/`): tela para TV em modo kiosk com indicadores de **manutenção da frota**, **abastecimento** e, no futuro, **estoque de combustível por localidade**. Atualiza a cada 30 min.
2. **Rastreamento** (`/rastreamento`): página com login para importar as planilhas do rastreador e analisar **viagens fora do horário** e **motor ligado parado**, com histórico e evidências.

- Produção: Render, serviço `painel-tv-rezende` (plano free, deploy automático na `main`).
- Sem banco próprio: o rastreamento usa tabelas `rast_*` no Supabase **Abast** (`horvznvaytzhwrmwjwxv`).
- O README.md tem o detalhe de cada parte (contratos de dados, variáveis, regras); mantenha-o atualizado junto com o código.

## Estrutura

- `server/index.js` — Express (ES modules): cache em memória reaquecido em segundo plano, `GET /api/painel` para a TV e as rotas do rastreamento; serve `public/`.
- `server/lib/`:
  - `sharepoint.js` — Graph com client credentials (mesmo app do CromFolgas, variáveis `SHAREPOINT_*`).
  - `manutencaoService.js` — lê e agrega `MANUTENÇÕES REZENDE ENERGIA.xlsx` do SharePoint (`MANUTENCAO_SHARE_URL`, `MANUTENCAO_SHEET`).
  - `abastecimentoService.js` — consome `GET /api/painel-tv` do Abast com `X-API-Key` (`ABASTECIMENTO_API_URL`, `ABASTECIMENTO_API_KEY`); o contrato da resposta está documentado aqui.
  - `estoqueService.js` — placeholder (card "Em breve").
  - `rastreamento.js` — API do rastreamento (login próprio, importação, consultas, evidências, usuários); todo acesso ao Supabase passa por aqui com a chave de serviço.
  - `formatters.js` — moeda e datas em pt-BR.
- `public/` — `index.html` + `app.js` (TV, tema escuro); `rastreamento.html` + `rastreamento.js`; regras do rastreamento em `fora-horario-core.js` e `ociosidade-core.js`; `xlsx-mini.js` lê a planilha no navegador.
- `server/test-run.mjs` — roda a agregação de manutenção sobre `server/test-fixture.xlsx` (`node server/test-run.mjs`). Rode depois de mexer na leitura da planilha de manutenção.
- Rodar local: `npm install && npm run dev`.

## Regras do rastreamento

- Expediente: segunda a sexta 08h–19h, sábado 08h–12h; domingo e feriado o dia todo é fora de horário. Viagem que encosta no horário proibido conta inteira; viagens de até 1 km são ignoradas. Feriados municipais e pontos facultativos são cadastrados na tela.
- Motor ligado parado: trechos com mais de 5 min; litros = horas × L/h (editável) e R$ = litros × preço médio pago no período (`fuel_records` do Abast).
- Sem duplicidade: arquivo repetido é recusado (hash SHA-256) e cada viagem/trecho é identificado por veículo + início + fim. Todas as viagens são guardadas, então mudar uma regra vale também para o histórico.
- Tabelas `rast_usuarios`, `rast_importacoes`, `rast_viagens`, `rast_ociosidade`, `rast_config`, funções `rast_importar` e `rast_precos`, bucket privado `rast-evidencias`. RLS ligado sem políticas: só o servidor acessa; o navegador nunca recebe chave do Supabase.
- Login próprio (cookie `rast_sess`, 12 h). O 1º administrador é `RAST_ADMIN_EMAIL` (padrão ti@) com `RAST_ADMIN_SENHA_INICIAL`, trocada no 1º acesso.

## Variáveis (Render)

`SHAREPOINT_CLIENT_ID/SECRET/TENANT_ID`, `MANUTENCAO_SHARE_URL`, `MANUTENCAO_SHEET`, `ABASTECIMENTO_API_URL`, `ABASTECIMENTO_API_KEY`, `RAST_SUPABASE_URL` (opcional), `RAST_SUPABASE_SERVICE_KEY`, `RAST_SESSION_SECRET`, `RAST_ADMIN_EMAIL`, `RAST_ADMIN_SENHA_INICIAL`. Sem as `RAST_*`, a TV funciona e só o `/rastreamento` mostra "não configurado".

## Cuidados

- A TV fica ligada o dia todo: erros de uma fonte devem aparecer só no card dela, sem derrubar a tela inteira.
- Mudança de esquema nas tabelas `rast_*` afeta o projeto Abast: use SQL idempotente e avise o dono antes.

## Ecossistema Rezende (vale para todos os sistemas)

- **Portal Rezende** (repo `Rezendeenergia/PortalRez`, https://portalrez.onrender.com) é a porta de entrada e o centro dos acessos: setores, pessoas e nível (visualizar / editar / administrar) ficam na tela **Acessos** do portal. Sistema novo deve perguntar ao portal quem pode entrar, em vez de manter lista própria de usuários.
- **Indicadores no portal:** o portal lê os totais de cada sistema chamando a função `portal.kpis()` no banco Supabase do sistema, com o usuário `portal_leitura` (só executa essa função). O SQL fica em `PortalRez/database/kpis/<chave>.sql`. Ao renomear ou mudar tabelas/colunas usadas ali, ajuste esse arquivo e a função no banco, senão a caixa do setor no portal quebra. Não apague o schema `portal` nem o papel `portal_leitura`.
- **Login:** somente conta Microsoft corporativa `@rezendeenergia.com.br`, tenant `56a8eefc-c653-4efd-a3db-db881ffbde6e`. O app do Azure usado para ler o SharePoint é o mesmo dos outros sistemas (variáveis `SHAREPOINT_CLIENT_ID/SECRET/TENANT_ID`).
- **Visual:** padrão Rezende (`rezende-tema.css` / `rezende-tema.js`, modo claro e escuro, laranja da marca, fontes Barlow). Telas novas seguem esse tema.
- **Idioma:** telas, mensagens, comentários e commits em português do Brasil, em linguagem simples (quem usa não é desenvolvedor). Datas no fuso de Santarém-PA (`America/Santarem`, UTC−3).
- **Deploy:** Render, com deploy automático a cada push na `main`. Banco: Supabase (região São Paulo).
- **Fluxo de trabalho:** mudanças vão por branch + pull request para a `main` (o dono revisa e faz o merge); só o PortalRez pode receber commit direto na `main`. Mudança de banco vai em arquivo `.sql` versionado no repo e é aplicada pelo dono no SQL Editor do Supabase; não rode SQL de alteração em produção sem ele pedir.
- **Segredos:** nunca escreva senha, chave ou token no código nem em commit; tudo vem de variável de ambiente no Render. Dados pessoais (CPF, salário, telefone) não vão para logs, prints ou planilhas exportadas sem necessidade.
