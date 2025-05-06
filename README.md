# iConnect Plus - Ứng dụng Nhắn tin Đa nền tảng

iConnect Plus là ứng dụng nhắn tin trực tuyến đa nền tảng, hỗ trợ cả Web và Mobile. Dự án bao gồm 3 phần chính: Web Frontend, Mobile Frontend và Backend.

## Tính năng chính

### Chung

- Đăng nhập, đăng ký, quên mật khẩu
- Nhắn tin trực tiếp 1:1
- Nhắn tin nhóm
- Gửi file, hình ảnh, âm thanh, video
- Phản hồi và phản ứng tin nhắn
- Quản lý danh bạ và nhóm
- Tìm kiếm người dùng, nhóm, tin nhắn
- Thông báo trực tuyến
- Hiển thị trạng thái (online/offline)
- Chỉnh sửa hồ sơ cá nhân

### Đồng bộ giữa Web và Mobile

- Giao diện thống nhất với bộ màu sắc chung
- Hệ thống emoji và biểu tượng cảm xúc
- Định dạng tin nhắn
- Kết nối Socket.IO thời gian thực
- Chức năng nhóm và quản lý thành viên
- Phản hồi tin nhắn và trích dẫn
- Xử lý file đa phương tiện

## Hướng dẫn cài đặt

### Yêu cầu hệ thống

- Node.js v14+
- MongoDB v4+
- React Native CLI (cho phiên bản mobile)
- Expo CLI (cho phiên bản mobile)

### Backend

```bash
# Di chuyển vào thư mục server
cd server

# Cài đặt các dependency
npm install

# Tạo file .env với các biến môi trường sau
# Xem file .env.example để biết thêm chi tiết

# Khởi động server
npm start
```

### Web Frontend

```bash
# Di chuyển vào thư mục web
cd web

# Cài đặt các dependency
npm install

# Chỉnh sửa file constants/api.ts nếu cần thiết để trỏ đến đúng API URL

# Khởi động ứng dụng web
npm start
```

### Mobile Frontend

```bash
# Di chuyển vào thư mục mobile
cd mobile

# Cài đặt các dependency
npm install

# Chỉnh sửa file src/config/api.ts nếu cần thiết để trỏ đến đúng API URL

# Khởi động ứng dụng mobile với Expo
npm start
```

## Hướng dẫn sử dụng

### Web

1. **Đăng nhập/Đăng ký**

   - Truy cập trang web và đăng nhập hoặc đăng ký tài khoản mới
   - Nếu quên mật khẩu, sử dụng chức năng "Quên mật khẩu"

2. **Nhắn tin**

   - Chọn người dùng từ danh sách bạn bè hoặc tab "Chats"
   - Nhập tin nhắn và nhấn Enter hoặc nút gửi
   - Sử dụng biểu tượng đính kèm để gửi file, hình ảnh
   - Nhấn vào tin nhắn để hiện menu với các tùy chọn: Phản hồi, Chỉnh sửa, Xóa, Phản ứng

3. **Quản lý danh bạ**

   - Sử dụng tab "Friends" để xem, thêm, xóa bạn bè
   - Tìm kiếm người dùng qua email hoặc tên

4. **Nhóm**

   - Tạo nhóm mới từ tab "Groups"
   - Thêm thành viên vào nhóm
   - Quản lý nhóm (đổi tên, thêm/xóa thành viên, rời nhóm)

5. **Tìm kiếm**

   - Sử dụng thanh tìm kiếm để tìm người dùng, nhóm, tin nhắn
   - Lọc kết quả theo loại

6. **Hồ sơ cá nhân**
   - Chỉnh sửa thông tin cá nhân trong tab "Profile"
   - Đổi mật khẩu, cập nhật ảnh đại diện

### Mobile

1. **Đăng nhập/Đăng ký**

   - Mở ứng dụng và đăng nhập hoặc đăng ký tài khoản mới
   - Nếu quên mật khẩu, sử dụng chức năng "Quên mật khẩu"

2. **Nhắn tin**

   - Chọn người dùng từ tab "Chats"
   - Nhập tin nhắn và nhấn nút gửi
   - Sử dụng nút đính kèm để gửi file, hình ảnh, âm thanh hoặc video
   - Nhấn giữ tin nhắn để hiện menu với các tùy chọn: Phản hồi, Chỉnh sửa, Xóa, Phản ứng

3. **Quản lý danh bạ**

   - Sử dụng tab "Contacts" để xem và quản lý danh bạ
   - Tìm kiếm người dùng thông qua thanh tìm kiếm

4. **Nhóm**

   - Tạo nhóm mới từ nút "+" trong tab "Chats"
   - Quản lý nhóm từ trang chi tiết nhóm

5. **Tìm kiếm**

   - Sử dụng tab "Search" để tìm kiếm đa nền tảng
   - Lọc kết quả theo người dùng, nhóm, tin nhắn

6. **Hồ sơ cá nhân**
   - Chỉnh sửa thông tin cá nhân trong tab "Profile"
   - Cài đặt ứng dụng, đổi mật khẩu, cập nhật ảnh đại diện

## Tính năng Socket.IO

Ứng dụng sử dụng Socket.IO để kết nối thời gian thực giữa các thiết bị. Các sự kiện được đồng bộ bao gồm:

- `send_message`: Khi tin nhắn mới được gửi
- `receive_message`: Khi nhận được tin nhắn mới
- `typing_start`: Khi người dùng bắt đầu nhập tin nhắn
- `typing_end`: Khi người dùng ngừng nhập tin nhắn
- `message_edited`: Khi tin nhắn được chỉnh sửa
- `message_deleted`: Khi tin nhắn bị xóa
- `reaction_added`: Khi thêm phản ứng vào tin nhắn
- `reaction_removed`: Khi gỡ phản ứng khỏi tin nhắn
- `user_online`: Khi người dùng online
- `user_offline`: Khi người dùng offline
- `group_update`: Khi thông tin nhóm được cập nhật

## Cấu trúc dự án

```
iConnectPluss/
├── server/           # Backend API và Socket Server
├── web/              # Frontend Web (React)
└── mobile/           # Frontend Mobile (React Native)
```

## Công nghệ sử dụng

### Backend

- Node.js + Express
- MongoDB + Mongoose
- Socket.IO
- JWT Authentication
- Multer (xử lý upload file)
- Cloudinary (lưu trữ file)
- Nodemailer (gửi email)

### Web Frontend

- React
- Redux + Redux Toolkit
- React Router
- Socket.IO Client
- Axios
- SCSS
- FontAwesome
- Bootstrap

### Mobile Frontend

- React Native
- Expo
- React Navigation
- Socket.IO Client
- Axios
- AsyncStorage
- Expo Notifications
- Expo ImagePicker & DocumentPicker

## Đóng góp

Nếu bạn muốn đóng góp vào dự án, vui lòng tạo Pull Request và mô tả chi tiết về các thay đổi được đề xuất.

## Giấy phép

[MIT License](LICENSE)
