# IE Team – Task & Project Tracking (v1.4.2)

Một file `index.html` duy nhất (HTML/CSS/JS) + Supabase cho Task / Project / Time Off.
User & đăng nhập hardcode trong `index.html` (`window.HARDCODED_USER_ROWS`).

## Nội dung
```
index.html            App (một file, chứa toàn bộ CSS + JS)
version.json          Số phiên bản trên server (app tự tải lại khi có bản mới)
manifest.json, sw.js  Cho phép "Install app"
.nojekyll             GitHub Pages phục vụ file nguyên trạng
tools/excel_to_users.py  Tạo danh sách user từ Excel
```

## Deploy / cập nhật trên GitHub Pages
1. **Giải nén zip trên máy** (GitHub không tự giải nén file .zip).
2. Repo → **Add file → Upload files** → kéo các FILE bên trong thư mục (không kéo cả thư mục) → **Commit**.
3. Lần đầu: Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
4. Đợi 1–2 phút → mở app → **Ctrl+F5**. Cuối sidebar phải hiện **IE Team app v1.4.2**.

## Quyền
- Đăng nhập: User + Password.
- App Admin: mọi team, toàn quyền. Team Admin: team của mình sửa được, team khác chỉ xem. Member: team của mình.
- Ẩn khỏi báo cáo (vẫn tính Headcount): `HIDDEN_FROM_REPORTS` trong `APP_CONFIG` (mặc định `['Anny']`).

## Project Management
- **Status tự tính** (không chọn tay):
  Actual có ngày → Completed · trước Start → Not Started · quá Plan Completed → Overdue · còn lại → Working.
- Form Create/Edit chia 4 phần: Project information · Owners · Schedule · Progress & results.
- **Owner(s)** chọn nhiều người từ danh sách member của Team đang chọn.

## Changelog
- **v1.4.2** – Status project tự tính theo Start/Plan/Actual/hôm nay; form Create/Edit Project mới; Owner(s) chọn từ member.
- **v1.4.1** – Gộp thành một file index.html.
- **v1.4.0** – Chỉ tải dữ liệu tuần hiện tại, tải lại theo filter; export Task (PIC, Usage Time, Text); ẩn Anny; kiểm tra phiên bản.
- **v1.3.0** – Sửa export Project rỗng; tăng tốc Weekly Workload & chuyển trang.
- **v1.2.x** – Headcount đủ App Admin; task Project processing tính workload; export Project/Task format mới.
- **v1.1.0** – Bỏ đăng nhập Viewer; Team Admin xem team khác (view only).
