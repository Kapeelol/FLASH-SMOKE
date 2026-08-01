-- FLASH KRATOM Delivery — Supabase schema
-- วิธีใช้: เปิดโปรเจกต์ Supabase ของคุณ -> เมนู "SQL Editor" -> New query -> วางไฟล์นี้ทั้งหมด -> Run
-- รันได้ปลอดภัยซ้ำได้ (มี IF NOT EXISTS / ON CONFLICT)

create table if not exists users (
  id           text primary key,
  fullname     text not null default '',
  phone        text unique,
  email        text,
  salt         text,
  hash         text,
  verified     boolean not null default false,
  role         text not null default 'customer',
  line_user_id text unique,
  avatar       text default '',
  points       int not null default 0,
  approved     boolean not null default true,
  created_at   bigint not null
);
-- migration: เผื่อ table users ถูกสร้างไว้ก่อนเพิ่มฟีเจอร์อีเมล OTP / แต้มสะสม / อนุมัติคนส่งของ
alter table users add column if not exists email text;
alter table users add column if not exists points int not null default 0;
alter table users add column if not exists approved boolean not null default true;

create table if not exists otps (
  phone      text primary key,
  code       text not null,
  expires_at bigint not null,
  tries      int not null default 0
);

create table if not exists addresses (
  id         text primary key,
  user_id    text not null references users(id) on delete cascade,
  label      text default 'ที่อยู่',
  kind       text default 'other',
  text       text default '',
  detail     text default '',
  lat        double precision,
  lng        double precision,
  created_at bigint not null
);
create index if not exists addresses_user_id_idx on addresses(user_id);

create table if not exists products (
  id          text primary key,
  name        text not null,
  description text default '',
  price       int not null default 0,
  emoji       text default '🛍️',
  tag         text default '',
  image       text,
  stock       int not null default 0,
  created_at  bigint not null
);

create table if not exists orders (
  id             text primary key,
  user_id        text not null references users(id),
  customer_name  text default '',
  phone          text default '',
  customer_source text default 'phone',
  items          jsonb not null default '[]',
  subtotal       int not null default 0,
  delivery_fee   int not null default 0,
  total          int not null default 0,
  address_id     text,
  address_text   text,
  addr_lat       double precision,
  addr_lng       double precision,
  addr_detail    text,
  payment        jsonb not null default '{}',
  slip_image     text,
  status         text not null default 'received',
  status_history jsonb not null default '[]',
  points_earned  int not null default 0,
  created_at     bigint not null
);
create index if not exists orders_user_id_idx on orders(user_id);
create index if not exists orders_created_at_idx on orders(created_at desc);
-- migration: เผื่อ table orders ถูกสร้างไว้ก่อนเพิ่มการแยกประเภทลูกค้า / แต้มสะสม
alter table orders add column if not exists customer_source text default 'phone';
alter table orders add column if not exists points_earned int not null default 0;

-- ของรางวัลสำหรับแลกแต้ม + ประวัติการแลก
create table if not exists rewards (
  id          text primary key,
  name        text not null,
  description text default '',
  points_cost int not null default 0,
  emoji       text default '🎁',
  image       text,
  stock       int not null default 0,
  created_at  bigint not null
);
create table if not exists redemptions (
  id            text primary key,
  user_id       text not null references users(id),
  customer_name text default '',
  phone         text default '',
  reward_id     text,
  reward_name   text,
  points_cost   int not null default 0,
  status        text not null default 'pending',
  created_at    bigint not null
);
create index if not exists redemptions_user_id_idx on redemptions(user_id);

create table if not exists settings (
  id            int primary key default 1,
  delivery_fee  int not null default 20,
  free_qty      int not null default 2,
  ad_image      text default 'assets/banner.jpg',
  ad_enabled    boolean not null default true,
  banners       jsonb not null default '["assets/banner.jpg"]'
);
insert into settings (id) values (1) on conflict (id) do nothing;
-- migration: เผื่อ table settings ถูกสร้างไว้ก่อนเพิ่มฟีเจอร์แบนเนอร์สไลด์
alter table settings add column if not exists banners jsonb not null default '["assets/banner.jpg"]';

-- ปิดการเข้าถึงตรงจากภายนอก (frontend ไม่คุยกับ Supabase โดยตรง — backend เท่านั้นที่ใช้ service_role key
-- ซึ่ง bypass RLS อยู่แล้ว; การเปิด RLS ไว้แบบไม่มี policy คือการป้องกันชั้นที่สองเผื่อ anon key หลุด)
alter table users enable row level security;
alter table otps enable row level security;
alter table addresses enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table settings enable row level security;
alter table rewards enable row level security;
alter table redemptions enable row level security;

-- Storage bucket สำหรับรูปภาพ (สินค้า/สลิป/โฆษณา/รูปโปรไฟล์) — ตั้งเป็น public เพื่อให้โหลดรูปแสดงผลได้
-- (เขียนรูปเข้าไปได้เฉพาะ backend ที่ถือ service_role key เท่านั้น — public ที่นี่หมายถึง "อ่านได้" ไม่ใช่ "เขียนได้")
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

