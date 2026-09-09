// Placeholder para o futuro controle de estoque de combustível por
// localidade. Ainda não existe fonte de dados — quando existir (planilha,
// API própria, ou o mesmo padrão do abastecimento), troque o corpo desta
// função por uma leitura real. O front-end já sabe renderizar o card
// "em breve" enquanto `disponivel` for false.
export async function fetchEstoque() {
  return {
    disponivel: false,
    motivo: 'Integração ainda não implementada — planejado para uma próxima etapa.',
    geradoEm: null,
    porLocalidade: [],
  };
}
