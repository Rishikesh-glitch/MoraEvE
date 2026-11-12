-- Run this script in Supabase Dashboard > SQL Editor.
create table if not exists public.events (
  id text primary key,
  title text not null,
  organizer text not null default '',
  venue text not null default '',
  date date not null,
  price numeric(10, 2) not null default 0 check (price >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.events
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

alter table public.events
  add column if not exists organizer text not null default '';

insert into public.events (id, title, venue, date, price)
values
  ('seed0', 'Mora Music Night', 'Lagan', current_date + 2, 1500),
  ('seed1', 'Campus Cultural Fest', 'Robert Peries', current_date + 5, 0),
  ('seed2', 'Stand-up Comedy Evening', 'Lagan', current_date + 9, 2000),
  ('seed3', 'Inter-Faculty Cricket Final', 'Robert Peries', current_date + 3, 500),
  ('seed4', 'Drama: Sinhala Classics', 'Lagan', current_date + 20, 1200),
  ('seed5', 'Open Mic Friday', 'Robert Peries', current_date + 1, 0)
on conflict (id) do update
  set title = excluded.title,
      venue = excluded.venue,
      date = excluded.date,
      price = excluded.price;

create table if not exists public.registrations (
  id text primary key,
  event_id text not null,
  event_title text not null,
  name text not null,
  email text not null,
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  registered_at timestamptz not null default now()
);

alter table public.registrations
  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

create unique index if not exists registrations_user_event_unique
  on public.registrations (user_id, event_id)
  where user_id is not null;

create table if not exists public.members (
  id text primary key,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_orders (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null references public.events(id) on delete restrict,
  event_title text not null,
  event_date date not null,
  buyer_name text not null,
  buyer_email text not null,
  quantity integer not null check (quantity between 1 and 5),
  total_amount numeric(10, 2) not null check (total_amount >= 0),
  currency text not null check (currency = 'LKR'),
  status text not null check (status in ('pending', 'free_pending', 'paid', 'failed', 'cancelled')),
  payhere_transaction_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.tickets (
  code text primary key,
  order_id text not null references public.ticket_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null references public.events(id) on delete restrict,
  event_title text not null,
  event_date date not null,
  buyer_name text not null,
  buyer_email text not null,
  ticket_number integer not null,
  created_at timestamptz not null default now(),
  unique (order_id, ticket_number)
);

alter table public.events enable row level security;
alter table public.registrations enable row level security;
alter table public.members enable row level security;
alter table public.ticket_orders enable row level security;
alter table public.tickets enable row level security;

revoke all on table public.events, public.registrations, public.members from anon, authenticated;
revoke select (id, title, organizer, venue, date, price, created_at, created_by)
  on table public.events from anon, authenticated;
revoke insert (id, title, organizer, venue, date, price, created_by)
  on table public.events from authenticated;
revoke select (id, event_id, event_title, name, email, registered_at, user_id)
  on table public.registrations from authenticated;
revoke insert (id, event_id, event_title, name, email, user_id)
  on table public.registrations from authenticated;
revoke select (id, name, email, created_at)
  on table public.members from authenticated;
revoke all on table public.ticket_orders, public.tickets from anon, authenticated;
grant select on public.events to service_role;
grant all on public.ticket_orders, public.tickets to service_role;
grant select (code, order_id, user_id, event_id, event_title, event_date, buyer_name, ticket_number, created_at)
  on public.tickets to authenticated;
grant select (id, title, organizer, venue, date, price) on table public.events to anon, authenticated;
grant insert (id, title, organizer, venue, date, price) on table public.events to authenticated;
grant select (id, event_id, event_title, name, email, registered_at)
  on table public.registrations to authenticated;
grant insert (id, event_id, event_title, name, email)
  on table public.registrations to authenticated;
grant select (id, name, email, created_at) on table public.members to authenticated;

drop policy if exists "Anyone can view events" on public.events;
create policy "Anyone can view events"
  on public.events for select
  to anon, authenticated
  using (true);

drop policy if exists "Signed-in users can create events" on public.events;
create policy "Signed-in users can create events"
  on public.events for insert
  to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists "Users can view their registrations" on public.registrations;
create policy "Users can view their registrations"
  on public.registrations for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can register themselves" on public.registrations;
create policy "Users can register themselves"
  on public.registrations for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.events where events.id = registrations.event_id)
  );

drop policy if exists "Users can view their profile" on public.members;
create policy "Users can view their profile"
  on public.members for select
  to authenticated
  using (id = (select auth.uid()::text));

drop policy if exists "Users can view their own tickets" on public.tickets;
create policy "Users can view their own tickets"
  on public.tickets for select
  to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.finalize_ticket_order(
  p_order_id text,
  p_transaction_id text,
  p_amount numeric,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.ticket_orders%rowtype;
begin
  select * into v_order
    from public.ticket_orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'Ticket order not found';
  end if;

  if v_order.status = 'paid' then
    return;
  end if;

  if p_amount is null
     or p_currency is null
     or p_currency <> v_order.currency
     or round(p_amount, 2) <> v_order.total_amount then
    raise exception 'Payment amount or currency does not match the order';
  end if;

  if v_order.total_amount = 0 then
    if v_order.status <> 'free_pending' then
      raise exception 'Free ticket order is not awaiting issuance';
    end if;
  elsif v_order.status <> 'pending' then
    raise exception 'Paid ticket order is not awaiting payment';
  end if;

  update public.ticket_orders
    set status = 'paid',
        payhere_transaction_id = p_transaction_id
    where id = p_order_id;

  insert into public.tickets (
    code, order_id, user_id, event_id, event_title, event_date,
    buyer_name, buyer_email, ticket_number
  )
  select
    'MORA-' || upper(replace(gen_random_uuid()::text, '-', '')),
    v_order.id,
    v_order.user_id,
    v_order.event_id,
    v_order.event_title,
    v_order.event_date,
    v_order.buyer_name,
    v_order.buyer_email,
    ticket_number
  from generate_series(1, v_order.quantity) as ticket_number;
end;
$$;

revoke all on function public.finalize_ticket_order(text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.finalize_ticket_order(text, text, numeric, text)
  to service_role;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.members (id, name, email)
  values (
    new.id::text,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(new.email, '')
  )
  on conflict (id) do update
    set name = excluded.name,
        email = excluded.email;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

notify pgrst, 'reload schema';
