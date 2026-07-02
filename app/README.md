# FLASH SMOKE — สั่งพอตในตัวเมืองชุมพร (Full System v5)

แอปสั่งของส่งไวในเมืองชุมพร — จากไฟล์ดีไซน์ กลายเป็น **ระบบจริงครบวงจร**
ดีไซน์หน้าตาเดิม + backend จริง + รูปสินค้า + สต็อกเรียลไทม์ + LINE Login + แจ้งเตือน LINE + พร้อม deploy ขึ้นใช้งานจริง

> ที่เก็บข้อมูลเลือกอัตโนมัติ: รันเฉย ๆ ไม่ตั้งค่าอะไร = ใช้ไฟล์ `db.json` ในเครื่อง (dev). ตั้งค่า Supabase = ข้อมูลจริงอยู่ถาวรบนคลาวด์ (ดูหัวข้อ [🚀 Deploy ใช้งานจริง](#-deploy-ใช้งานจริง-ฟรี--supabase--render) ด้านล่าง)

## รันยังไง (ไม่ต้องติดตั้งอะไรเพิ่ม)

ต้องมี **Node.js** แล้ว:

```bash
cd "app"
node server.js
```

เปิดเบราว์เซอร์ที่ **http://localhost:3000**

> ใช้เฉพาะโมดูลในตัวของ Node (http, https, crypto, fs) — **ไม่ต้อง `npm install`**

## บัญชีทดลอง (สร้างให้อัตโนมัติ)

| บทบาท | เบอร์ | รหัสผ่าน |
|-------|------|---------|
| ลูกค้า | `0800000000` | `demo1234` |
| แอดมิน | `0899999999` | `admin1234` |

## ฟีเจอร์ใหม่ v4

- **โลโก้จริง** — ใช้รูปโลโก้ FLASH SMOKE (`public/assets/logo.png`) ที่หน้า welcome และมุมซ้ายบนหน้าแรก (เอาตัวอักษร FLASH SMOKE เดิมออก)
- **แบนเนอร์ "พร้อมส่งแล้ววันนี้"** — ใช้รูปพื้นหลัง (`public/assets/banner.jpg`)
- **ส่งฟรีตามจำนวนชิ้น** — "ส่งฟรีเมื่อสั่งครบ N ตัว" (นับจำนวนชิ้นรวม, ค่าเริ่มต้น 2)
- **แอดมินตั้งค่าจัดส่งได้** — กำหนดค่าส่ง (บาท) และจำนวนขั้นต่ำส่งฟรี → มีผลกับลูกค้าทันที (ผ่าน SSE)
- **แอดมินดูรายละเอียดออเดอร์ + ตำแหน่งหมุด** — กด "ดูรายละเอียด" เห็นแผนที่ที่ลูกค้าปักหมุด, พิกัด, สลิป, ประวัติสถานะ
- **หน้าประวัติยอดขาย (แอดมิน)** — แท็บ "ยอดขาย": ยอดขายรวม, จำนวนออเดอร์, เฉลี่ย/ออเดอร์, กราฟยอดขายรายวัน, อันดับสินค้าขายดี
- **หน้าแรกสุด (welcome)** — เหลือเฉพาะโลโก้ (เอาสโลแกนออก)
- **ป๊อปอัพโฆษณา** — เด้งรูปโฆษณาตอน "ลูกค้า" ล็อกอินเข้าใช้ (แอดมินไม่เห็น); ปิดได้ด้วย ✕ หรือแตะพื้นหลัง; แอดมินเปลี่ยนรูป/เปิด-ปิด/ลบได้ในแท็บ "สินค้า" (การ์ด 📢 รูปโฆษณา) — ค่าเริ่มต้นใช้รูป Marbo
- **ลูกค้าแก้ไขโปรไฟล์** — แตะการ์ดทักทายที่หน้าแรก → แก้ชื่อ/เบอร์/รูปโปรไฟล์
- **อัปโหลดสลิปโอนเงิน** — ออเดอร์ที่จ่ายแบบโอน กดอัปโหลดสลิปได้ในหน้าติดตามออเดอร์; แอดมินเห็นสลิปในหน้ารายละเอียด

> เปลี่ยนรูปโลโก้/แบนเนอร์ได้โดยแทนไฟล์ `public/assets/logo.png` และ `public/assets/banner.jpg`

## ฟีเจอร์ v3

- **รูปภาพสินค้า** — แอดมินอัปโหลดไฟล์รูปได้ (เก็บที่ `public/uploads/`) หรือใส่ URL; ลูกค้าเห็นรูปจริงบนเมนู/ตะกร้า
- **สต็อกเรียลไทม์** — ลูกค้าเห็นจำนวนคงเหลือ (พร้อมส่ง / เหลือ N ชิ้น / สินค้าหมด); ตัดสต็อกอัตโนมัติเมื่อสั่งซื้อ, กันการสั่งเกินสต็อก; อัปเดต **สดทุกหน้าจอทันที** ผ่าน Server-Sent Events (เมื่อมีคนสั่งหรือแอดมินปรับสต็อก ทุกเครื่องเห็นพร้อมกัน)
- **LINE Login จริง** — ปุ่ม "เข้าสู่ระบบด้วย LINE" ทำ OAuth 2.0 กับ LINE จริง (เอา Facebook/Google ออกแล้ว)
- **แจ้งเตือนผ่าน LINE API** — ออเดอร์ใหม่/เปลี่ยนสถานะ ส่งเข้า LINE ทั้งฝั่งร้าน และฝั่งลูกค้าที่ล็อกอินด้วย LINE
- **เปลี่ยนชื่อ** — สโลแกนเป็น **"สั่งพอตในตัวเมืองชุมพร"**

รวมของเดิม: สมัคร/OTP/เข้าสู่ระบบ, ที่อยู่จัดส่ง, ตะกร้า, ชำระเงิน, ติดตามสถานะ, แผงแอดมิน

---

## ตั้งค่า LINE ให้ใช้งานจริง (สำคัญ)

ระบบเขียนพร้อมใช้แล้ว แต่ต้องใส่ **กุญแจของคุณเอง** จาก LINE Developers จึงจะเชื่อมต่อจริง
ถ้าไม่ใส่ ปุ่ม LINE จะขึ้นข้อความ "ยังไม่ได้ตั้งค่า" และการแจ้งเตือนจะเป็นแบบ log อย่างเดียว

### 1) LINE Login (สำหรับปุ่มเข้าสู่ระบบด้วย LINE)
1. ไปที่ https://developers.line.biz/console/ → สร้าง Provider → สร้าง **LINE Login channel**
2. ในแท็บ **LINE Login** ใส่ Callback URL:
   `http://localhost:3000/api/auth/line/callback`
   (ถ้าขึ้นโดเมนจริง ให้เปลี่ยนเป็นโดเมนนั้น)
3. เอา **Channel ID** และ **Channel secret** มาตั้งเป็น env

### 2) LINE แจ้งเตือน (Messaging API push)
1. สร้าง **Messaging API channel** → เอา **Channel access token (long-lived)**
2. หา `LINE_TO` = userId/groupId ของร้าน (เช่นแอดมิน/กลุ่มร้านที่แอด OA เป็นเพื่อน)
3. อยากให้ลูกค้าที่ล็อกอิน LINE ได้รับแจ้งเตือนเข้าไลน์ตัวเอง → ต้อง **ลิงก์ LINE Login channel กับ Messaging API channel** ไว้ใน provider เดียวกัน และลูกค้าต้องแอด OA เป็นเพื่อน

### 3) รันพร้อม env (PowerShell)
```powershell
$env:LINE_LOGIN_CHANNEL_ID="xxxxxxxxxx"
$env:LINE_LOGIN_CHANNEL_SECRET="xxxxxxxxxxxxxxxxxxxx"
$env:LINE_CHANNEL_ACCESS_TOKEN="xxxxx...(Messaging API)"
$env:LINE_TO="Uxxxxxxxx...(userId/groupId ร้าน)"
# ถ้ารันบนโดเมนจริง:
# $env:LINE_LOGIN_REDIRECT="https://your-domain/api/auth/line/callback"
node server.js
```
ตอนรัน จะมีบรรทัด `LINE Login: พร้อมใช้` และ `LINE Push: พร้อมส่งจริง` ยืนยัน

---

## 🚀 Deploy ใช้งานจริง (ฟรี) — Supabase + Render

ระบบรองรับ 2 โหมดที่เก็บข้อมูล เลือกอัตโนมัติจาก environment variable:
- **ไม่ตั้งค่า Supabase** -> ใช้ไฟล์ `db.json` ในเครื่อง (โหมด dev เดิม รันได้ทันที)
- **ตั้งค่า `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`** -> ใช้ Supabase (Postgres + Storage) ข้อมูลอยู่รอดแม้ host รีสตาร์ท/รีดีพลอย — จำเป็นสำหรับใช้งานจริง

### ขั้นตอนที่ 1 — สร้างฐานข้อมูล (Supabase, ฟรี)
1. สมัคร/ล็อกอินที่ https://supabase.com -> **New project** (เลือก region ใกล้ผู้ใช้ เช่น Singapore)
2. เมนู **SQL Editor** -> New query -> คัดลอกไฟล์ [`app/supabase/schema.sql`](supabase/schema.sql) ทั้งหมดไปวาง -> กด **Run**
   (สคริปต์นี้สร้างตารางทั้งหมด + storage bucket ชื่อ `uploads` ให้พร้อมในทีเดียว)
3. เมนู **Project Settings > API** -> คัดลอก 2 ค่านี้เก็บไว้:
   - **Project URL** (เช่น `https://xxxxx.supabase.co`) -> ใช้เป็น `SUPABASE_URL`
   - **service_role key** (ไม่ใช่ anon key!) -> ใช้เป็น `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ **service_role key เป็นความลับระดับสูง** (bypass ทุกการป้องกันของฐานข้อมูล) ห้ามใส่ในโค้ดหรือ commit ขึ้น git เด็ดขาด — ใช้เป็น environment variable บนโฮสต์เท่านั้น
>
> ข้อจำกัดฟรี: Supabase free tier มี DB 500MB + Storage 1GB — เพียงพอสำหรับร้านเริ่มต้นมาก ๆ, แต่โปรเจกต์จะ **พักการทำงานอัตโนมัติหากไม่มีการเรียก API เลยเกิน 1 สัปดาห์** (กดปลุกได้ในหน้า dashboard ไม่มีข้อมูลหาย)

### ขั้นตอนที่ 2 — เตรียมโค้ดขึ้น GitHub
```bash
# จากโฟลเดอร์โปรเจกต์ (นอก app/)
git remote add origin https://github.com/<username>/<repo>.git
git branch -M main
git push -u origin main
```

### ขั้นตอนที่ 3 — Deploy ขึ้น Render (ฟรี)
1. สมัคร/ล็อกอินที่ https://render.com -> เชื่อมบัญชี GitHub
2. **New +** -> **Web Service** -> เลือก repo นี้
3. ตั้งค่า:
   - **Root Directory**: `app`
   - **Build Command**: (เว้นว่างไว้ หรือใส่ `echo ok`)
   - **Start Command**: `node server.js`
   - **Plan**: Free
4. ในแท็บ **Environment** ใส่ตัวแปรต่อไปนี้ (ค่าที่ได้จากขั้นตอนที่ 1):
   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `APP_SECRET` | (สุ่มสตริงยาว ๆ ของคุณเอง) |
   | `SUPABASE_URL` | จากขั้นตอนที่ 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | จากขั้นตอนที่ 1 |
5. กด **Create Web Service** — รอ deploy เสร็จ (~1-2 นาที) จะได้ URL แบบ `https://flash-smoke-xxxx.onrender.com`

> ⚠️ ข้อจำกัดฟรีของ Render: service จะ **หยุดพักหลังไม่มีคนเข้าใช้ 15 นาที** คำขอถัดไปจึงช้าไปครั้งแรก (~30-50 วินาที "ปลุกเครื่อง") — พอใช้เปิดร้านช่วงเริ่มต้นได้สบาย ๆ ค่อยอัปเกรดทีหลังถ้าต้องการให้ตอบไวตลอดเวลา

### ขั้นตอนที่ 4 — (ถ้าใช้) อัปเดต LINE Login callback URL ให้ตรงโดเมนจริง
ใน LINE Developers Console > LINE Login channel > แก้ **Callback URL** เป็น:
```
https://<โดเมนจริงจาก Render>/api/auth/line/callback
```
แล้วตั้ง env `LINE_LOGIN_REDIRECT` บน Render ให้ตรงกันด้วย

### ขั้นตอนที่ 5 — ส่ง OTP ทางอีเมลจริง (Brevo, ฟรี 300 อีเมล/วัน)
1. สมัครที่ https://www.brevo.com (ฟรี ไม่ต้องใช้บัตร)
2. **Settings > Senders, Domains & Dedicated IPs > Senders** -> Add a sender -> ใส่อีเมลของร้าน (เช่น Gmail ของคุณ) แล้วกดยืนยันลิงก์ที่ส่งไปในอีเมลนั้น (ไม่ต้องมีโดเมนของตัวเอง)
3. **Settings > SMTP & API > API Keys** -> Generate a new API key -> คัดลอกเก็บไว้
4. ตั้ง env บน Render:
   | Key | Value |
   |---|---|
   | `BREVO_API_KEY` | API key จากข้อ 3 |
   | `MAIL_FROM` | อีเมล sender ที่ยืนยันแล้วในข้อ 2 |
   | `MAIL_FROM_NAME` | `FLASH SMOKE` (หรือชื่อร้าน) |

ตอนรัน จะมีบรรทัด `Email OTP: พร้อมส่งจริง (Brevo...)` ยืนยัน — ถ้ายังไม่ตั้ง จะเป็น log-only (โชว์รหัสใน terminal เฉพาะตอน dev)

> ⚠️ **สำคัญ (migration):** ถ้าคุณรัน `schema.sql` เวอร์ชันก่อนหน้าไปแล้ว ตาราง `users` จะยังไม่มีคอลัมน์ `email` — ให้เปิด Supabase SQL Editor แล้วรันบรรทัดนี้ครั้งเดียว:
> ```sql
> alter table users add column if not exists email text;
> ```

## ตั้งค่าโปรดักชันอื่น ๆ
```powershell
$env:NODE_ENV="production"   # ซ่อนรหัส OTP บนหน้าจอ (ต้องต่อ SMS จริงเอง)
$env:APP_SECRET="<คีย์ลับยาว>" # เซ็น token
$env:PORT="3000"
```

## โครงสร้างไฟล์
```
app/
├─ server.js            # backend (API + LINE OAuth + LINE push + SSE + เสิร์ฟเว็บ)
├─ db.json              # ฐานข้อมูล (สร้างอัตโนมัติ + seed บัญชีทดลอง)
├─ public/
│  ├─ index.html · styles.css · app.js
│  └─ uploads/          # รูปสินค้าที่อัปโหลด (สร้างอัตโนมัติ)
└─ README.md
```

## API สรุป (เพิ่มจาก v2)

| Method | Path | ใช้ทำ | สิทธิ์ |
|--------|------|-------|-------|
| GET | `/api/auth/line/login` | เริ่ม LINE Login (redirect) | - |
| GET | `/api/auth/line/callback` | รับ callback จาก LINE | - |
| GET | `/api/auth/line/config` | เช็คว่าตั้งค่า LINE แล้วหรือยัง | - |
| GET | `/api/stream` | สต็อกเรียลไทม์ (SSE) | - |
| POST | `/api/admin/products` | เพิ่มสินค้า (มี stock + รูป) | admin |
| POST | `/api/admin/products/stock` | ปรับสต็อก `{id,stock}` | admin |
| POST | `/api/admin/products/image` | ตั้งรูปสินค้า `{id,imageData\|image}` | admin |
| DELETE | `/api/admin/products` | ลบสินค้า `{id}` | admin |

(API เดิม: register/otp/login/me, addresses, orders, admin/orders + status — ดูในโค้ด)

## หมายเหตุ
- อัปโหลดรูป: รับไฟล์ภาพ ≤ 3MB, เก็บเป็นไฟล์จริงใน `public/uploads/`
- สต็อกเรียลไทม์ใช้ SSE (EventSource) — ไม่ต้องรีเฟรชหน้า
- แผนที่ยังเป็นแบบจำลอง (สร้างที่อยู่จากตำแหน่งหมุด) แต่บันทึกพิกัดจริง — ต่อ reverse-geocoding จริงได้
