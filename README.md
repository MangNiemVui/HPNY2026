# Thiệp Năm Mới (GitHub Pages)

## Chạy local
- Mở thư mục bằng VSCode, dùng Live Server (khuyên dùng) hoặc bất kỳ web server tĩnh nào.

## Deploy GitHub Pages
- Settings → Pages → Deploy from a branch → main /root

## Thêm ảnh từng người
- Đặt ảnh trong `avatars/` theo key trong `avatars/people.json`, ví dụ:
  - `avatars/bethucute.jpg`
- Nếu không có ảnh, sẽ dùng `avatars/default.png`

## Nhạc
- File nhạc nằm trong `music/`
- Danh sách nhạc ở `music/playlist.json`

## Firebase + EmailJS (mới)

### A) File cấu hình
- `config.js` chứa toàn bộ cấu hình Firebase + EmailJS + owner email.
- **Không dùng EmailJS Private Key trên web** (chỉ dùng Public Key).

### B) Tạo Firestore
Firebase Console → **Build → Firestore Database** → **Create database**
- Edition: **Standard**
- Database ID: `(default)`
- Region: chọn gần Việt Nam (Singapore/Taiwan/Tokyo)
- Mode: **Start in test mode** (để chạy ngay)

### C) Bật Authentication
Firebase Console → **Build → Authentication**
1) Tab **Sign-in method**
- Bật **Anonymous** (bắt buộc để visitor ghi `views/wishes`)
- (Tuỳ chọn) Bật **Google** để Owner đăng nhập xem dashboard

2) **Settings → Authorized domains**
- Thêm domain bạn deploy (vd: `mangniemvui.github.io`) và `localhost`

### D) Firestore Rules
Sau khi test chạy OK, vào **Firestore → Rules** và publish.

#### 1) Demo (ai đăng nhập anonymous cũng có thể đọc/ghi) — KHÔNG khuyên dùng
```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

#### 2) Khuyên dùng: Visitor chỉ được ghi, Owner (Google UID) mới được đọc dashboard
1) Owner mở website → đăng nhập thiệp bằng tài khoản owner (role owner)
2) Bấm **Owner Google Login** → đăng nhập Google
3) Vào Firebase → Authentication → Users → copy **UID**
4) Dán UID vào:
- `config.js` → `window.OWNER_UID = "..."`  
- Firestore Rules ở dưới (thay `PASTE_OWNER_UID_HERE`)

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner() {
      return request.auth != null
        && request.auth.uid == "PASTE_OWNER_UID_HERE";
    }

    match /views/{id} {
      allow create, update: if request.auth != null;
      allow read: if isOwner();
    }

    match /wishes/{id} {
      allow create: if request.auth != null;
      allow read: if isOwner();
    }
  }
}
```

### E) EmailJS Template variables
Template cần có các biến (đúng với `services.js`):
- `{{to_email}}`
- `{{from_name}}`
- `{{from_key}}`
- `{{card_target}}`
- `{{message}}`
- `{{time}}`
