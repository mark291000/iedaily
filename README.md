# IE Team – Task & Project Tracking

Static web app (HTML/CSS/JS, không cần server) + Supabase cho dữ liệu Task / Project / Time Off.
User & đăng nhập được **hardcode** trong `js/data/users.js` (không dùng database).

## Cấu trúc

```
index.html                 Giao diện (markup)
css/base.css               Style gốc trong <head>
css/tailwind.css           Tailwind đã build sẵn (thay cho CDN)
css/app.css                Style của app + các bản vá, giữ đúng thứ tự
js/config.js               Supabase URL / key, thời gian gom realtime
js/data/users.js           DANH SÁCH USER (Member | Team | Role | Password)
js/core/                   Code chính: app, data layer, multi-team
js/modules/                Các module/bản vá theo thứ tự load (đánh số)
tools/build-css.mjs        Build lại css/tailwind.css
tools/excel_to_users.py    Tạo lại users.js từ file Excel
.github/workflows/deploy.yml  Tự deploy lên GitHub Pages
```

> Thứ tự `<script>` trong `index.html` quan trọng – các module sau ghi đè module trước. Đừng đổi thứ tự.

## Chạy local
```bash
npx serve .          # hoặc: python -m http.server 5500
```
Mở http://localhost:5500 (không mở trực tiếp bằng file:// vì service worker).

## Deploy GitHub Pages
1. Tạo repo, push toàn bộ thư mục lên nhánh `main`.
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Mỗi lần push, workflow tự build CSS và deploy. Link: `https://<user>.github.io/<repo>/`.

> Repo **public** sẽ lộ `js/data/users.js` (có password). Nên để repo **Private**
> (GitHub Pages cho repo private cần gói Pro/Team/Enterprise) hoặc host nội bộ.

## Cập nhật user
- Sửa trực tiếp `js/data/users.js`, hoặc
- `pip install openpyxl` rồi `python tools/excel_to_users.py User_Team_Access.xlsx`.
- Cùng một tên nhiều dòng = 1 tài khoản nhiều team; dòng đầu tiên là team Main.
- Đăng nhập bằng password của dòng nào sẽ vào đúng team/role của dòng đó.

## Thêm class Tailwind mới
Nếu thêm class Tailwind mới vào HTML/JS:
```bash
npm install
npm run build:css
```
(Workflow deploy cũng tự chạy bước này.)

## Thay đổi về hiệu năng so với bản 1 file
- Bỏ Tailwind CDN (JIT chạy trên trình duyệt, quét lại DOM mỗi lần render) → CSS build sẵn.
- Observer theo dõi toàn bộ DOM để khóa dropdown team → giới hạn 1 lần/khung hình.
- Bỏ `setInterval` 1,5 giây kiểm tra quyền → chỉ chạy khi load dữ liệu / đổi trang.
- Realtime Supabase: gom thay đổi trong 1,2 giây và không reload khi tab đang ẩn.
- html2canvas / jsPDF tải `defer` (chỉ dùng khi xuất PDF).
- CSS/JS tách file → trình duyệt cache được, lần mở sau nhanh hơn.
- Xóa các script cũ không còn tác dụng (adapter localhost, runtime V31–V38 đã tắt).
