-- Adiciona fornecedor, valor unitário e quantidade em frota_manut_registros.
-- Projeto Supabase: Abast (horvznvaytzhwrmwjwxv).
-- Executar no SQL Editor do Supabase.
-- Idempotente: pode rodar de novo sem efeitos colaterais.
--
-- Motivo: o CSV importado traz fornecedor/valor unitário/quantidade, mas o
-- servidor nunca gravava esses campos. Como a tela sempre recarrega os
-- dados "oficiais" do servidor, todo registro voltava sem fornecedor —
-- por isso o gráfico "Gasto por fornecedor" mostrava uma única barra (—).

alter table frota_manut_registros
  add column if not exists fornecedor text,
  add column if not exists vu         numeric(14,2),
  add column if not exists qtd        numeric(14,2);

create index if not exists frota_manut_fornecedor_idx on frota_manut_registros (fornecedor);
