# IE Team – Task & Project Tracking

Static web app (HTML/CSS/JS) + Supabase cho Task / Project / Time Off.
User & đăng nhập được **hardcode** trong `js/data/users.js` (không dùng database).

## Đăng nhập & quyền xem team
- Chỉ 1 loại đăng nhập: **User + Password**.
- **App Admin**: chọn mọi team, toàn quyền.
- **Team Admin**: *My teams* = quyền bình thường; *Other teams* = chỉ xem.
- **Member**: chỉ team của mình.

## User ẩn khỏi báo cáo
Thêm tên vào `HIDDEN_FROM_REPORTS` trong `js/config.js`, hoặc thêm `"report": false` vào dòng user trong `js/data/users.js`
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
- **v1.4.0**
  - Mở app chỉ tải task của **tuần hiện tại** (+ task chưa hoàn thành). Đổi Year/Month/Week hoặc
    chuyển tuần/tháng/năm ở Weekly Workload -> chỉ tải lại bảng Tasks cho đúng khoảng đó.
    Xoá hết filter Year/Month/Week = tải toàn bộ.
  - IE Overall chỉ tải Year/Month/Week đang chọn (trước: cả năm, mọi team).
  - Category Setup: workload trung bình tính từ toàn bộ dữ liệu trên server.
  - Ẩn khỏi báo cáo nằm trong file lõi + `js/config.js` (`HIDDEN_FROM_REPORTS`).
  - Export Daily Tracking / My Tasks: luôn có PIC, cột **Usage Time** (không có "h"), mọi ô định dạng Text.
  - Sửa lỗi lần đầu mở Team Performance biểu đồ/bảng trống (từ v1.3).
  - Owner của project hiện đúng tên (kể cả người ẩn khỏi báo cáo).
  - Sidebar Workload hiện thêm dòng "Project hours (Gantt)".
  - `js/version-check.js` + `version.json`: báo đỏ nếu file trên server chưa cập nhật, tự tải lại khi có bản mới.
- **v1.3.0**
  - Export Project: sửa lỗi file rỗng (module đọc bản sao cũ `window.projectsList`); cột giống hệt bảng trên app.
  - Ẩn khỏi báo cáo cấu hình trong `js/config.js` → `HIDDEN_FROM_REPORTS` (mặc định `['Anny']`).
  - Weekly Workload / Team Performance tính workload bằng index (nhanh ~10–30 lần, kết quả giữ nguyên).
  - Chuyển trang không vẽ lại khi dữ liệu không đổi; quay lại tab trình duyệt không tải lại toàn bộ (trừ khi rời > 60 giây).
  - Thêm `?v=` vào mọi file JS/CSS để trình duyệt luôn tải bản mới; hiện số phiên bản ở cuối sidebar.
- **v1.2.3** – Export Daily Tracking / My Tasks lấy từ dữ liệu: luôn có cột PIC + Team, xuất đủ mọi dòng theo filter (không chỉ trang đang hiện).
- **v1.2.2** – Xuất Excel/PDF trang Project theo format mới (Team, Project name, Owner, Start, Plan Completed, Actual, Status, Current Stage, %Progress, Archived goal, Saving, Key Project), theo search + filter đang áp dụng.
- **v1.2.1** – Task Daily Tracking "Project: Project processing" luôn được tính workload; giờ Gantt của project chỉ cộng khi PIC chưa log task Project processing cùng ngày (không tính trùng).
- **v1.2** – Overall đếm đủ App Admin; user `report:false` chỉ tính headcount;
  lưu Project chỉ ghi phần thay đổi (song song, không tải lại toàn bộ);
  task Daily Tracking category *Project* được tính vào workload.
- **v1.1** – Bỏ đăng nhập Viewer; Team Admin xem team khác (view only); sửa giao diện Overall.
- **v1.0** – Tách project, bỏ Tailwind CDN, giảm lag.

## Khi phát hành bản mới
Đổi cùng 1 số phiên bản ở: `?v=` trong `index.html`, `APP_VERSION` trong `js/config.js`, `version.json`, và chuỗi `'1.4.0'` trong các file có `__appFiles`.
