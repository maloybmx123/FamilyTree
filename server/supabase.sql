-- Настройка Supabase для «Семейного Древа».
-- Выполнить один раз: в Supabase откройте SQL Editor, вставьте всё это и нажмите Run.

-- 1. Таблица с деревом
create table if not exists public.trees (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.trees enable row level security;

-- Доступ по анонимному ключу. Ключ знают только родственники — он и есть пропуск.
-- Разграничение между самими родственниками живёт в программе (роли и замки на записях).
drop policy if exists "drevo_read"  on public.trees;
drop policy if exists "drevo_write" on public.trees;
drop policy if exists "drevo_edit"  on public.trees;

create policy "drevo_read"  on public.trees for select using (true);
create policy "drevo_write" on public.trees for insert with check (true);
create policy "drevo_edit"  on public.trees for update using (true) with check (true);

-- 2. Хранилище для фотографий, документов, аудио и видео
insert into storage.buckets (id, name, public)
values ('drevo', 'drevo', false)
on conflict (id) do nothing;

drop policy if exists "drevo_files_read"   on storage.objects;
drop policy if exists "drevo_files_write"  on storage.objects;
drop policy if exists "drevo_files_edit"   on storage.objects;
drop policy if exists "drevo_files_delete" on storage.objects;

create policy "drevo_files_read"   on storage.objects for select using (bucket_id = 'drevo');
create policy "drevo_files_write"  on storage.objects for insert with check (bucket_id = 'drevo');
create policy "drevo_files_edit"   on storage.objects for update using (bucket_id = 'drevo');
create policy "drevo_files_delete" on storage.objects for delete using (bucket_id = 'drevo');

-- Готово. Дальше в программе:
--   ⚙ Настройки → Синхронизация → Supabase
--   Адрес проекта  — Project Settings → API → Project URL
--   Ключ           — там же, anon public
--   Имя дерева     — любое короткое слово латиницей, одинаковое у всех родственников
