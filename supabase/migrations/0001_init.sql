create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create type public.workspace_role as enum ('owner','admin','member');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'member',
  primary key (workspace_id, user_id)
);

create index on public.workspace_members (user_id);

create type public.board_visibility as enum ('private','workspace');
create type public.board_role        as enum ('admin','member','observer');

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  background_kind text not null default 'color' check (background_kind in ('color','image')),
  background_value text not null default '#0079bf',
  visibility public.board_visibility not null default 'workspace',
  created_by uuid not null references public.profiles(id) on delete restrict,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index on public.boards (workspace_id);

create table public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.board_role not null default 'member',
  primary key (board_id, user_id)
);

create index on public.board_members (user_id);
