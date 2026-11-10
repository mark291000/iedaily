# IE Team – Task & Project Tracking

Static web app (HTML/CSS/JS) + Supabase cho Task / Project / Time Off.
User & đăng nhập được **hardcode** trong `js/data/users.js` (không dùng database).

## Đăng nhập & quyền xem team
- Chỉ 1 loại đăng nhập: **User + Password** (đã bỏ đăng nhập Viewer).
- **App Admin**: dropdown Team chọn mọi team, toàn quyền (như cũ).
- **Team Admin**: dropdown Team có 2 nhóm
  - *My teams*: team của mình → quyền bình thường.
  - *Other teams (view only)*: team khác → chỉ xem, ẩn nút thêm/sửa/xóa.
  Chọn lại team của mình để quay về quyền chỉnh sửa.
- **Member**: chỉ team của mình (đổi giữa các team của mình nếu có nhiều team).

## Cấu trúc
```
index.html                 Giao diện
css/base.css               Style gốc trong <head>
css/tailwind.css           Tailwind build sẵn (thay CDN)
css/app.css                Style app + bản vá, giữ đúng thứ tự
js/config.js               Supabase URL / key
js/data/users.js           DANH SÁCH USER
js/core/, js/modules/      Code app, load theo số thứ tự (không đổi thứ tự)
tools/                     build CSS, tạo users.js từ Excel
```

## Deploy GitHub Pages
Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)`.
(Hoặc chọn *GitHub Actions* để dùng `.github/workflows/deploy.yml`.)

## Cập nhật user
Sửa `js/data/users.js`, hoặc `python tools/excel_to_users.py User_Team_Access.xlsx`.

## Thêm class Tailwind mới
`npm install && npm run build:css`
