-- Sammelstelle fuer die Statistik aller Spieler (Supabase, Postgres). ASCII-only wie die Skripte unter tools/.
--
-- Einmal im Supabase-Dashboard ausfuehren: SQL Editor -> New query -> alles einfuegen -> Run.
-- Das Skript ist wiederholbar: Tabellen, Regeln und die Funktion werden bei Bedarf ersetzt, bereits gesammelte Naechte bleiben.
-- Die letzte Zeile gibt den Schluessel fuer den Link der globalen Seite aus (siehe README, Abschnitt "Sammelstelle").
--
-- Was das Spiel schreiben darf: nur neue Zeilen in `runs` (RLS: INSERT fuer `anon`, sonst nichts).
-- Was die globale Seite lesen darf: nur die Zaehler aus `stats_overview(token)`, nie einzelne Zeilen. Die Funktion verlangt den
-- Schluessel aus dem Link; ohne ihn (oder mit einem falschen) gibt sie nichts heraus.

-- ---------------------------------------------------------------------------------------------------------------------
-- Die Naechte. Es gibt keinen Namen, keine Kennung des Geraets und keine IP-Adresse; `id` ist eine Zufallszahl je Nacht,
-- damit eine doppelt gesendete Nacht nur einmal zaehlt. Der Zeitpunkt kommt vom Server, nicht vom Spiel.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.runs (
  id uuid primary key,
  created_at timestamptz not null default now(),
  game_version text not null check (game_version ~ '^[0-9][0-9a-z.+-]{0,19}$'),
  class_id text not null check (class_id ~ '^[a-z0-9-]{1,40}$'),
  outcome text not null check (outcome in ('won', 'fallen', 'aborted')),
  seconds integer not null check (seconds between 0 and 86400),
  level integer not null check (level between 1 and 999),
  -- Staerkung -> Rang am Ende, Segen als Liste, Fertigkeit -> Rang am Ende (wie RunRecord in src/core/statistik.ts).
  upgrades jsonb not null default '{}' check (jsonb_typeof(upgrades) = 'object' and octet_length(upgrades::text) <= 2000),
  segen jsonb not null default '[]' check (jsonb_typeof(segen) = 'array' and octet_length(segen::text) <= 2000),
  skills jsonb not null default '{}' check (jsonb_typeof(skills) = 'object' and octet_length(skills::text) <= 2000)
);

alter table public.runs enable row level security;

-- Zugriff: das Spiel (Rolle `anon`) darf eintragen und sonst nichts. Ohne Regel fuer SELECT sieht niemand einzelne Zeilen.
revoke all on public.runs from anon, authenticated;
grant insert on public.runs to anon;

drop policy if exists "Das Spiel darf Naechte eintragen" on public.runs;
create policy "Das Spiel darf Naechte eintragen" on public.runs
  for insert to anon
  with check (true);

-- ---------------------------------------------------------------------------------------------------------------------
-- Der Schluessel fuer die globale Seite: wird einmal zufaellig erzeugt und steht nur hier. Wer ihn aendern will:
--   update public.stats_config set value = 'neuer-schluessel' where key = 'token';
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.stats_config (
  key text primary key,
  value text not null
);

alter table public.stats_config enable row level security;
revoke all on public.stats_config from anon, authenticated;

insert into public.stats_config (key, value)
values ('token', replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- Die Zaehler fuer die globale Seite: dieselbe Form wie `Auswertung` in src/core/auswertung.ts
--   { total: Tally, byClass: { <Klasse>: Tally } }
-- Naechte aus Entwicklungsfassungen (Fassung mit Endung "-dev") zaehlen nicht mit. Wer die Form der Zaehler aendert, aendert
-- beides: diese Funktion und `tallyRun` in src/core/auswertung.ts.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.stats_overview(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if token is null or token <> (select value from public.stats_config where key = 'token') then
    raise exception 'Falscher Schluessel' using errcode = '42501';
  end if;

  with live as (
    select * from public.runs where game_version !~ '-dev$'
  ),
  -- Jede Nacht zaehlt einmal fuer ihre Klasse und einmal fuer alle ('*').
  scoped as (
    select class_id as scope, r.* from live r
    union all
    select '*' as scope, r.* from live r
  ),
  base as (
    select scope,
           count(*) as nights,
           count(*) filter (where outcome = 'won') as wins,
           count(*) filter (where outcome = 'fallen') as falls,
           count(*) filter (where outcome = 'aborted') as aborts,
           coalesce(sum(seconds), 0) as seconds
    from scoped
    group by scope
  ),
  levels as (
    select scope, jsonb_object_agg(level::text, n) as j
    from (select scope, level, count(*) as n from scoped group by scope, level) t
    group by scope
  ),
  upgrades as (
    select scope, jsonb_object_agg(id, n) as j
    from (
      select s.scope, e.key as id,
             sum(case when e.value ~ '^[0-9]{1,2}$' then e.value::int else 0 end) as n
      from scoped s, jsonb_each_text(s.upgrades) e
      group by s.scope, e.key
    ) t
    group by scope
  ),
  segen as (
    select scope, jsonb_object_agg(id, n) as j
    from (
      select s.scope, e.value as id, count(*) as n
      from scoped s, jsonb_array_elements_text(s.segen) e(value)
      group by s.scope, e.value
    ) t
    group by scope
  ),
  skills as (
    select scope, jsonb_object_agg(id, ranks) as j
    from (
      select scope, id, jsonb_object_agg(rank, n) as ranks
      from (
        select s.scope, e.key as id, e.value as rank, count(*) as n
        from scoped s, jsonb_each_text(s.skills) e
        where e.value ~ '^[0-9]{1,2}$' and e.value::int > 0
        group by s.scope, e.key, e.value
      ) t1
      group by scope, id
    ) t2
    group by scope
  ),
  tallies as (
    select b.scope,
           jsonb_build_object(
             'nights', b.nights, 'wins', b.wins, 'falls', b.falls, 'aborts', b.aborts, 'seconds', b.seconds,
             'levels', coalesce(l.j, '{}'::jsonb),
             'upgrades', coalesce(u.j, '{}'::jsonb),
             'segen', coalesce(g.j, '{}'::jsonb),
             'skills', coalesce(k.j, '{}'::jsonb)
           ) as tally
    from base b
    left join levels l using (scope)
    left join upgrades u using (scope)
    left join segen g using (scope)
    left join skills k using (scope)
  )
  select jsonb_build_object(
           'total', coalesce((select tally from tallies where scope = '*'),
                             '{"nights":0,"wins":0,"falls":0,"aborts":0,"seconds":0,"levels":{},"upgrades":{},"segen":{},"skills":{}}'::jsonb),
           'byClass', coalesce((select jsonb_object_agg(scope, tally) from tallies where scope <> '*'), '{}'::jsonb)
         )
  into result;

  return result;
end;
$$;

revoke all on function public.stats_overview(text) from public;
grant execute on function public.stats_overview(text) to anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- Das Ergebnis dieses Laufs: der Teil des Links hinter dem "#" (an die Adresse der globalen Seite haengen).
-- ---------------------------------------------------------------------------------------------------------------------
select 'statistik-global.html#' || value as link_ende from public.stats_config where key = 'token';
