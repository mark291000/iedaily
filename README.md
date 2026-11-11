# IE Team – Task & Project Tracking

Static web app (HTML/CSS/JS) + Supabase cho Task / Project / Time Off.
User & đăng nhập được **hardcode** trong `js/data/users.js` (không dùng database).

## Đăng nhập & quyền xem team
- Chỉ 1 loại đăng nhập: **User + Password**.
- **App Admin**: chọn mọi team, toàn quyền.
- **Team Admin**: *My teams* = quyền bình thường; *Other teams* = chỉ xem.
- **Member**: chỉ team của mình.

## User ẩn khỏi báo cáo
Thêm `"report": false` vào dòng user trong `js/data/users.js`
(hoặc cột E = `No` trong Excel). User đó vẫn tính **Headcount** ở Overall
nhưng không hiện trong báo cáo / workload và không tính workload.

## Cấu trúc
```
index.html, css/, js/config.js, js/data/users.js, js/core/, js/modules/, tools/
```
Thứ tự `<script>` trong `index.html` quan trọng – không đổi thứ tự.

## Deploy GitHub Pages
Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)`.

## Cập nhật user
Sửa `js/data/users.js`, hoặc `python tools/excel_to_users.py User_Team_Access.xlsx`.

## Thêm class Tailwind mới
`npm install && npm run build:css`

## Changelog
- **v1.2** – Overall đếm đủ App Admin; user `report:false` chỉ tính headcount;
  lưu Project chỉ ghi phần thay đổi (song song, không tải lại toàn bộ);
  task Daily Tracking category *Project* được tính vào workload.
- **v1.1** – Bỏ đăng nhập Viewer; Team Admin xem team khác (view only); sửa giao diện Overall.
- **v1.0** – Tách project, bỏ Tailwind CDN, giảm lag.
