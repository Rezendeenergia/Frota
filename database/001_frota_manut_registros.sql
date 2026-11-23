-- Histórico de registros de manutenção importados via planilha CSV.
-- Projeto Supabase: Abast (horvznvaytzhwrmwjwxv).
-- Executar no SQL Editor do Supabase.
-- Idempotente: pode rodar de novo sem efeitos colaterais.

create table if not exists frota_manut_registros (
  id          bigint  generated always as identity primary key,
  -- Chave de deduplicação: OSM (ou placa+data+item quando não há OSM)
  chave       text    not null unique,
  -- Campos da planilha
  osm         text,
  placa       text,
  modelo      text,
  data        text,          -- formato DD/MM/AAAA (vindo da planilha)
  tipo        text,          -- CORRETIVA / PREVENTIVA / etc.
  cat         text,          -- categoria (tipo de serviço)
  item        text,
  vt          numeric(14,2) default 0,
  status      text,
  obs         text,
  -- Metadados
  importado_em timestamptz not null default now()
);

-- Índices úteis para os filtros mais comuns
create index if not exists frota_manut_placa_idx on frota_manut_registros (placa);
create index if not exists frota_manut_data_idx  on frota_manut_registros (data);
create index if not exists frota_manut_tipo_idx  on frota_manut_registros (tipo);

-- RLS: ligado sem política pública — só o servidor (service_role) acessa.
alter table frota_manut_registros enable row level security;
