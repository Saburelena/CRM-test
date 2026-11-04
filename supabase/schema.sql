-- Мини-CRM. Скрипт заново создаёт таблицы, правила "кто что видит" и примеры объектов с задачами.
-- Почты manager@test.com, executor@test.com и executor2@test.com уже заведены вручную. 
-- Пароль у всех: password123.

do $$
begin
  if not exists (select 1 from auth.users where lower(email) = 'manager@test.com') then
    raise exception 'Нет пользователя manager@test.com';
  end if;
  if not exists (select 1 from auth.users where lower(email) = 'executor@test.com') then
    raise exception 'Нет пользователя executor@test.com';
  end if;
  if not exists (select 1 from auth.users where lower(email) = 'executor2@test.com') then
    raise exception 'Нет пользователя executor2@test.com';
  end if;
end $$;

create schema if not exists private;

drop table if exists public.task_history cascade;
drop table if exists public.tasks cascade;
drop table if exists public.objects cascade;
drop table if exists public.profiles cascade;

drop function if exists public.change_task_status(uuid, text, text);
drop function if exists private.user_role();
drop function if exists private.check_task_update();
drop function if exists private.log_task_created();
drop function if exists private.block_history_change();
drop function if exists private.mark_task_delete();

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager', 'executor'))
);

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null references public.objects (id) on delete cascade,
  title text not null,
  description text,
  executor_id uuid references public.profiles (id),
  status text not null default 'new' check (status in ('new', 'in_progress', 'review', 'accepted', 'rework')),
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  changed_by uuid not null references public.profiles (id),
  old_status text,
  new_status text not null,
  comment text,
  created_at timestamptz not null default now()
);

create index tasks_object_id_idx on public.tasks (object_id);
create index tasks_executor_id_idx on public.tasks (executor_id);
create index task_history_task_id_idx on public.task_history (task_id);

-- Роль того, кто вошёл: manager или executor.
-- Читает таблицу профилей profiles мимо правил доступа, иначе правило снова спросит роль и запрос зациклится.
create function private.user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Проверяет смену статуса. Другой переход база не примет.
-- Вернуть на доработку без комментария тоже нельзя.
-- Текст комментария приходит вместе со сменой статуса, отдельным шагом его не обойти.
create function private.check_task_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role text;
  note text;
begin
  role := private.user_role();

  if role is null then
    raise exception 'Нет доступа';
  end if;

  if role = 'executor' then
    if old.executor_id is distinct from auth.uid() then
      raise exception 'Это не ваша задача';
    end if;

    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.object_id is distinct from old.object_id
      or new.author_id is distinct from old.author_id
      or new.executor_id is distinct from old.executor_id
      or new.created_at is distinct from old.created_at
      or new.id is distinct from old.id
    then
      raise exception 'Исполнитель может менять только статус';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
      (role = 'executor' and old.status = 'new' and new.status = 'in_progress')
      or (role = 'executor' and old.status = 'in_progress' and new.status = 'review')
      or (role = 'executor' and old.status = 'rework' and new.status = 'in_progress')
      or (role = 'manager' and old.status = 'review' and new.status = 'accepted')
      or (role = 'manager' and old.status = 'review' and new.status = 'rework')
    ) then
      raise exception 'Такой переход статуса запрещён';
    end if;

    note := nullif(btrim(coalesce(current_setting('app.task_comment', true), '')), '');

    if new.status = 'rework' and note is null then
      raise exception 'Для возврата на доработку нужен комментарий';
    end if;

    insert into public.task_history (task_id, changed_by, old_status, new_status, comment)
    values (old.id, auth.uid(), old.status, new.status, note);
  end if;

  return new;
end;
$$;

create function private.log_task_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  insert into public.task_history (task_id, changed_by, old_status, new_status)
  values (new.id, auth.uid(), null, new.status);

  return new;
end;
$$;

-- Пометка: историю можно стереть только вместе с задачей. Отдельно её стереть нельзя.
create function private.mark_task_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.deleting_task', '1', true);
  return old;
end;
$$;

create function private.block_history_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.deleting_task', true) = '1' then
    return old;
  end if;

  raise exception 'Историю менять нельзя';
end;
$$;

create trigger tasks_check_update
  before update on public.tasks
  for each row execute function private.check_task_update();

create trigger tasks_log_insert
  after insert on public.tasks
  for each row execute function private.log_task_created();

create trigger tasks_mark_delete
  before delete on public.tasks
  for each row execute function private.mark_task_delete();

create trigger task_history_no_change
  before update or delete on public.task_history
  for each row execute function private.block_history_change();

-- Одно действие: проверить, можно ли сменить статус, записать его и добавить строку в историю.
create function public.change_task_status(
  p_task_id uuid,
  p_status text,
  p_comment text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('app.task_comment', coalesce(p_comment, ''), true);

  update public.tasks
  set status = p_status
  where id = p_task_id;

  if not found then
    raise exception 'Задача не найдена или нет доступа';
  end if;
end;
$$;

revoke all on function public.change_task_status(uuid, text, text) from public;
grant execute on function public.change_task_status(uuid, text, text) to authenticated;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.user_role() from public;
revoke all on function private.check_task_update() from public;
revoke all on function private.log_task_created() from public;
revoke all on function private.block_history_change() from public;
revoke all on function private.mark_task_delete() from public;
grant execute on function private.user_role() to authenticated;
grant execute on function private.check_task_update() to authenticated;
grant execute on function private.log_task_created() to authenticated;
grant execute on function private.block_history_change() to authenticated;
grant execute on function private.mark_task_delete() to authenticated;

-- При создании проекта была выключена галочка "сразу открывать новые таблицы".
-- Без строк ниже сайт получает отказ, даже если правила "кто что видит" написаны верно.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.objects from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.task_history from anon, authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.objects to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, delete on public.task_history to authenticated;

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_history enable row level security;

create policy "profiles read" on public.profiles
  for select to authenticated
  using (true);

create policy "objects read" on public.objects
  for select to authenticated
  using (
    private.user_role() = 'manager'
    or exists (
      select 1 from public.tasks
      where tasks.object_id = objects.id
        and tasks.executor_id = auth.uid()
    )
  );

create policy "objects insert" on public.objects
  for insert to authenticated
  with check (private.user_role() = 'manager');

create policy "objects update" on public.objects
  for update to authenticated
  using (private.user_role() = 'manager')
  with check (private.user_role() = 'manager');

create policy "objects delete" on public.objects
  for delete to authenticated
  using (private.user_role() = 'manager');

create policy "tasks read" on public.tasks
  for select to authenticated
  using (private.user_role() = 'manager' or executor_id = auth.uid());

create policy "tasks insert" on public.tasks
  for insert to authenticated
  with check (
    private.user_role() = 'manager'
    and author_id = auth.uid()
    and status = 'new'
  );

create policy "tasks update" on public.tasks
  for update to authenticated
  using (private.user_role() = 'manager' or executor_id = auth.uid())
  with check (private.user_role() = 'manager' or executor_id = auth.uid());

create policy "tasks delete" on public.tasks
  for delete to authenticated
  using (private.user_role() = 'manager');

create policy "history read" on public.task_history
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks
      where tasks.id = task_history.task_id
        and (private.user_role() = 'manager' or tasks.executor_id = auth.uid())
    )
  );

-- Удалить строку истории разрешено всем, кто вошёл.
-- Если задачу при этом не удаляют, срабатывает запрет "Историю менять нельзя".
-- Когда удаляют задачу, история уходит вместе с ней.
create policy "history delete" on public.task_history
  for delete to authenticated
  using (true);

insert into public.profiles (id, email, role)
select id, email, 'manager' from auth.users where lower(email) = 'manager@test.com';

insert into public.profiles (id, email, role)
select id, email, 'executor' from auth.users where lower(email) = 'executor@test.com';

insert into public.profiles (id, email, role)
select id, email, 'executor' from auth.users where lower(email) = 'executor2@test.com';

alter table public.tasks disable trigger user;
alter table public.task_history disable trigger user;

insert into public.objects (id, name, address) values
  ('a0000000-0000-4000-8000-000000000001', 'ЖК Солнечный', 'ул. Ленина, 1'),
  ('a0000000-0000-4000-8000-000000000002', 'Школа №5', 'ул. Пушкина, 10'),
  ('a0000000-0000-4000-8000-000000000003', 'Склад', 'пр. Мира, 25');

insert into public.tasks (id, object_id, title, description, executor_id, status, author_id, created_at) values
  (
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Покраска подъезда',
    'Секция А, первый и второй этаж',
    (select id from public.profiles where email = 'executor@test.com'),
    'new',
    (select id from public.profiles where email = 'manager@test.com'),
    timestamptz '2026-11-03 08:00:00+00'
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'Замена окон',
    'Второй этаж, сторона двора',
    (select id from public.profiles where email = 'executor2@test.com'),
    'in_progress',
    (select id from public.profiles where email = 'manager@test.com'),
    timestamptz '2026-11-02 09:00:00+00'
  ),
  (
    'b0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000002',
    'Электрика',
    'Разводка на втором этаже',
    (select id from public.profiles where email = 'executor@test.com'),
    'review',
    (select id from public.profiles where email = 'manager@test.com'),
    timestamptz '2026-11-01 09:00:00+00'
  ),
  (
    'b0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000002',
    'Кровля',
    'Покрытие над спортзалом',
    (select id from public.profiles where email = 'executor2@test.com'),
    'accepted',
    (select id from public.profiles where email = 'manager@test.com'),
    timestamptz '2026-10-28 09:00:00+00'
  ),
  (
    'b0000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000003',
    'Стяжка пола',
    'Первый пролёт',
    (select id from public.profiles where email = 'executor@test.com'),
    'rework',
    (select id from public.profiles where email = 'manager@test.com'),
    timestamptz '2026-10-30 09:00:00+00'
  );

insert into public.task_history (task_id, changed_by, old_status, new_status, comment, created_at) values
  ('b0000000-0000-4000-8000-000000000001', (select id from public.profiles where email = 'manager@test.com'), null, 'new', null, timestamptz '2026-11-03 08:00:00+00'),
  ('b0000000-0000-4000-8000-000000000002', (select id from public.profiles where email = 'manager@test.com'), null, 'new', null, timestamptz '2026-11-02 09:00:00+00'),
  ('b0000000-0000-4000-8000-000000000002', (select id from public.profiles where email = 'executor2@test.com'), 'new', 'in_progress', null, timestamptz '2026-11-02 11:00:00+00'),
  ('b0000000-0000-4000-8000-000000000003', (select id from public.profiles where email = 'manager@test.com'), null, 'new', null, timestamptz '2026-11-01 09:00:00+00'),
  ('b0000000-0000-4000-8000-000000000003', (select id from public.profiles where email = 'executor@test.com'), 'new', 'in_progress', null, timestamptz '2026-11-01 10:00:00+00'),
  ('b0000000-0000-4000-8000-000000000003', (select id from public.profiles where email = 'executor@test.com'), 'in_progress', 'review', null, timestamptz '2026-11-04 15:00:00+00'),
  ('b0000000-0000-4000-8000-000000000004', (select id from public.profiles where email = 'manager@test.com'), null, 'new', null, timestamptz '2026-10-28 09:00:00+00'),
  ('b0000000-0000-4000-8000-000000000004', (select id from public.profiles where email = 'executor2@test.com'), 'new', 'in_progress', null, timestamptz '2026-10-28 12:00:00+00'),
  ('b0000000-0000-4000-8000-000000000004', (select id from public.profiles where email = 'executor2@test.com'), 'in_progress', 'review', null, timestamptz '2026-10-30 12:00:00+00'),
  ('b0000000-0000-4000-8000-000000000004', (select id from public.profiles where email = 'manager@test.com'), 'review', 'accepted', null, timestamptz '2026-10-31 10:00:00+00'),
  ('b0000000-0000-4000-8000-000000000005', (select id from public.profiles where email = 'manager@test.com'), null, 'new', null, timestamptz '2026-10-30 09:00:00+00'),
  ('b0000000-0000-4000-8000-000000000005', (select id from public.profiles where email = 'executor@test.com'), 'new', 'in_progress', null, timestamptz '2026-10-30 11:00:00+00'),
  ('b0000000-0000-4000-8000-000000000005', (select id from public.profiles where email = 'executor@test.com'), 'in_progress', 'review', null, timestamptz '2026-11-02 16:00:00+00'),
  ('b0000000-0000-4000-8000-000000000005', (select id from public.profiles where email = 'manager@test.com'), 'review', 'rework', 'Неровно вдоль стены, переделать полосу у ворот', timestamptz '2026-11-03 12:00:00+00');

alter table public.tasks enable trigger user;
alter table public.task_history enable trigger user;

notify pgrst, 'reload schema';
