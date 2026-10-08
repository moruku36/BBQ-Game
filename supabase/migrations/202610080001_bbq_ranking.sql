-- REVIEWED DRAFT ONLY. Applying this file changes access/security and requires approval.
-- No production deployment or credentials are configured by the repository.
begin;
create schema if not exists bbq_private;
revoke all on schema bbq_private from public, anon, authenticated;
grant usage on schema bbq_private to service_role;

create table if not exists bbq_private.runs (
  id uuid primary key default gen_random_uuid(),
  seed bigint not null check(seed between 1 and 4294967295),
  version int not null check(version=2),
  mode text not null check(mode='standard'),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '15 minutes'
);
create table if not exists bbq_private.receipts (
  run_id uuid primary key, digest text not null check(length(digest)=64),
  name text not null, score int not null check(score between 1 and 99999),
  ranked boolean not null, expires_at timestamptz not null,
  actions jsonb not null check(jsonb_array_length(actions)<=512),
  seed bigint not null, actions_expires_at timestamptz not null
);
create table if not exists bbq_private.scores (
  run_id uuid primary key, name text not null check(char_length(name) between 1 and 12),
  score int not null check(score between 1 and 99999),
  accepted_at timestamptz not null default clock_timestamp()
);
create table if not exists bbq_private.rates (
  bucket text primary key, count int not null, expires_at timestamptz not null
);
create index if not exists bbq_rates_expiry on bbq_private.rates(expires_at);
create index if not exists bbq_runs_issued on bbq_private.runs(issued_at);
create index if not exists bbq_receipts_expiry on bbq_private.receipts(expires_at);
create index if not exists bbq_receipt_action_expiry on bbq_private.receipts(actions_expires_at) where actions<>'[]'::jsonb;
alter table bbq_private.runs enable row level security;
alter table bbq_private.receipts enable row level security;
alter table bbq_private.scores enable row level security;
alter table bbq_private.rates enable row level security;
revoke all on all tables in schema bbq_private from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema bbq_private to service_role;

create or replace function public.bbq_dispatch(p_action text, p_hash text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog set lock_timeout='2s' as $$
declare
  ts timestamptz := clock_timestamp();
  minute bigint := floor(extract(epoch from ts)/60);
  tenmin bigint := floor(extract(epoch from ts)/600);
  route text;
  keys text[];
  caps int[];
  windows int[];
  n int;
  i int;
  allowed boolean := true;
  run bbq_private.runs%rowtype;
  receipt bbq_private.receipts%rowtype;
  ranked boolean;
  rows jsonb;
begin
  if p_action='admit' then
    if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid hash'; end if;
    -- One small global lock serialises counters and bounded TTL cleanup.
    perform pg_advisory_xact_lock(272705);
    with expired as (select bucket from bbq_private.rates where expires_at<=ts limit 200)
      delete from bbq_private.rates where bucket in (select expired.bucket from expired);
    with expired as (select id from bbq_private.runs where issued_at<=ts-interval '24 hours' limit 100)
      delete from bbq_private.runs where id in (select id from expired);
    with expired as (select run_id from bbq_private.receipts where expires_at<=ts limit 100)
      delete from bbq_private.receipts where run_id in (select run_id from expired);
    update bbq_private.receipts set actions='[]'::jsonb where run_id in
      (select run_id from bbq_private.receipts where actions_expires_at<=ts and actions<>'[]'::jsonb limit 100);
    keys := array['all:g:'||minute, 'all:h:'||p_hash||':'||minute];
    caps := array[600,120]; windows := array[60,60];
    route := p_payload->>'route';
    -- GET and failed POST requests count too; invalid method/route still consumes all.
    if route='top' and p_payload->>'method'='GET' then
      keys:=keys||array['top:g:'||minute,'top:h:'||p_hash||':'||minute];
      caps:=caps||array[300,60]; windows:=windows||array[60,60];
    elsif route in ('runs','scores') and p_payload->>'method'='POST' then
      keys:=keys||array[route||':g:'||minute,route||':h:'||p_hash||':'||tenmin];
      caps:=caps||array[120,case when route='runs' then 20 else 10 end];
      windows:=windows||array[60,600];
    end if;
    for i in 1..array_length(keys,1) loop
      insert into bbq_private.rates(bucket,count,expires_at) values(keys[i],1,ts+interval '1 hour')
      on conflict(bucket) do update set count=least(bbq_private.rates.count+1,1000000)
      returning count into n;
      -- Global exhaustion rejects before allocating a new per-hash bucket.
      if i=1 and n>caps[i] then return jsonb_build_object('ok',false,'retryAfter',60); end if;
      if n>caps[i] then allowed:=false; end if;
    end loop;
    return jsonb_build_object('ok',allowed,'retryAfter',600);
  elsif p_action='create' then
    insert into bbq_private.runs(seed,version,mode)
      values((p_payload->>'seed')::bigint,(p_payload->>'version')::int,p_payload->>'mode')
      returning * into run;
    return jsonb_build_object('runId',run.id,'seed',run.seed,'version',run.version,'mode',run.mode,
      'expiresAt',floor(extract(epoch from run.expires_at)*1000));
  elsif p_action='run' then
    select * into run from bbq_private.runs where id=(p_payload->>'runId')::uuid;
    if not found or run.issued_at<=ts-interval '24 hours' then
      select * into receipt from bbq_private.receipts where run_id=(p_payload->>'runId')::uuid and expires_at>ts;
      if not found then return null; end if;
      return jsonb_build_object('seed',receipt.seed,'version',2,'mode','standard');
    end if;
    return jsonb_build_object('seed',run.seed,'version',run.version,'mode',run.mode);
  elsif p_action='accept' then
    select * into receipt from bbq_private.receipts where run_id=(p_payload->>'runId')::uuid;
    if found then
      if receipt.expires_at<=ts then return jsonb_build_object('state','expired'); end if;
      if receipt.digest<>p_payload->>'digest' then return jsonb_build_object('state','conflict'); end if;
      return jsonb_build_object('state','accepted','score',receipt.score,'ranked',receipt.ranked);
    end if;
    select * into run from bbq_private.runs where id=(p_payload->>'runId')::uuid for update;
    if not found then return jsonb_build_object('state','expired'); end if;
    -- A concurrent accept may have completed while this request waited for its run lock.
    select * into receipt from bbq_private.receipts where run_id=run.id;
    if found then
      if receipt.expires_at<=ts then return jsonb_build_object('state','expired'); end if;
      if receipt.digest<>p_payload->>'digest' then return jsonb_build_object('state','conflict'); end if;
      return jsonb_build_object('state','accepted','score',receipt.score,'ranked',receipt.ranked);
    end if;
    if run.expires_at<=ts then return jsonb_build_object('state','expired'); end if;
    if run.issued_at>ts-interval '60 seconds' then return jsonb_build_object('state','early'); end if;
    if length(p_payload->>'digest')<>64 or char_length(p_payload->>'name') not between 1 and 12
       or (p_payload->>'score')::int not between 1 and 99999 then raise exception 'invalid score'; end if;
    perform pg_advisory_xact_lock(272706);
    insert into bbq_private.scores(run_id,name,score)
      values(run.id,p_payload->>'name',(p_payload->>'score')::int);
    delete from bbq_private.scores where run_id not in
      (select run_id from bbq_private.scores order by score desc,accepted_at asc,run_id asc limit 3);
    select exists(select 1 from bbq_private.scores where run_id=run.id) into ranked;
    insert into bbq_private.receipts(run_id,digest,name,score,ranked,expires_at,actions,seed,actions_expires_at)
      values(run.id,p_payload->>'digest',p_payload->>'name',(p_payload->>'score')::int,ranked,
        ts+interval '24 hours',p_payload->'actions',run.seed,run.issued_at+interval '24 hours');
    return jsonb_build_object('state','accepted','score',(p_payload->>'score')::int,'ranked',ranked);
  elsif p_action='top' then
    select coalesce(jsonb_agg(jsonb_build_object('name',name,'score',score) order by score desc,accepted_at asc,run_id asc),'[]'::jsonb)
      into rows from bbq_private.scores;
    return jsonb_build_object('rows',rows);
  end if;
  raise exception 'invalid operation';
end $$;
revoke all on function public.bbq_dispatch(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.bbq_dispatch(text,text,jsonb) to service_role;
commit;
