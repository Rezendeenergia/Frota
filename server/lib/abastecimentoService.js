// Lê o painel de abastecimento a partir de um endpoint dedicado que o
// próprio sistema de abastecimento (abast-56aa.onrender.com) precisa expor.
//
// CONTRATO ESPERADO — implemente isto no app de abastecimento:
//
//   GET /api/painel-tv?periodo=hoje|7dias|30dias|mes  (padrão: 7dias)
//   Header: X-API-Key: <mesmo valor de ABASTECIMENTO_API_KEY aqui>
//   200 OK, corpo JSON:
//   {
//     "geradoEm": "2026-09-08T12:00:00.000Z",
//     "periodo": "últimos 7 dias",              // texto livre p/ mostrar na TV
//     "totalLitros": 4230.5,
//     "custoTotal": 25120.30,
//     "qtdAbastecimentos": 58,
//     "pendentesAprovacao": 3,                  // status aguardando aprovação (fila, não janela de tempo)
//     "porTipoCombustivel": [ { "chave": "DIESEL", "litros": 1800, "custo": 10800 }, ... ],
//     "porVeiculo": [ { "chave": "QCP2G44 · Ranger", "litros": 320, "custo": 1920 }, ... ],
//     "bombonas": [                             // reservatórios/bombonas de campo
//       { "nome": "Bombona Norte", "litrosRestantes": 1200, "capacidade": 5000 }, ...
//     ],
//     "custoPorMes": [ { "mes": "2026-04", "custo": 18230.5 }, ... ]  // últimos 6 meses, fixo (não segue o `periodo`)
//   }
//
// Qualquer campo que ainda não exista pode vir null/[]/0 — o front-end da
// TV já sabe mostrar "sem dado" nesses casos, sem quebrar o layout.
//
// Por quê um endpoint próprio (em vez deste serviço ler o banco direto)?
// Mesmo padrão do CromFolgas: mantém a autenticação e o schema do banco de
// abastecimento encapsulados no próprio sistema, e o painel da TV só
// consome uma API estável — se o schema interno mudar, só esse endpoint
// precisa ser ajustado.

function emptyAbastecimento(motivo) {
  return {
    disponivel: false,
    motivo,
    geradoEm: null,
    periodo: null,
    totalLitros: null,
    custoTotal: null,
    qtdAbastecimentos: null,
    pendentesAprovacao: null,
    porTipoCombustivel: [],
    porVeiculo: [],
    bombonas: [],
    custoPorMes: [],
  };
}

// `periodo`: 'hoje' | '7dias' | '30dias' | 'mes' — repassado como query
// string para o endpoint do sistema de abastecimento (ver contrato acima).
// Vem do filtro de período clicável na tela (ver public/app.js).
export async function fetchAbastecimento(periodo = '7dias') {
  const url = process.env.ABASTECIMENTO_API_URL;
  const apiKey = process.env.ABASTECIMENTO_API_KEY;

  if (!url || !apiKey) {
    return emptyAbastecimento(
      'ABASTECIMENTO_API_URL / ABASTECIMENTO_API_KEY não configuradas ainda neste serviço.'
    );
  }

  try {
    const urlComPeriodo = `${url}${url.includes('?') ? '&' : '?'}periodo=${encodeURIComponent(periodo)}`;
    const res = await fetch(urlComPeriodo, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return { disponivel: true, motivo: null, ...data };
  } catch (err) {
    return emptyAbastecimento(`Falha ao consultar o painel de abastecimento: ${err?.message || err}`);
  }
}
