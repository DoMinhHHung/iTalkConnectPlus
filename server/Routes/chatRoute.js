const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { authMiddleware } = require("../Middlewares/authMiddleware");
const multer = require("multer");
const mongoose = require("mongoose");

// Sử dụng memoryStorage thay vì diskStorage để giữ file trong bộ nhớ
// trước khi tải lên MongoDB
const storage = multer.memoryStorage();

// Tạo middleware upload với cấu hình storage
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // Giới hạn 50MB
  },
  fileFilter: function (req, file, cb) {
    // Kiểm tra loại file (tùy chọn)
    const filetypes = /jpeg|jpg|png|gif|mp4|mp3|pdf|doc|docx|xls|xlsx|zip/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = file.originalname
      ? filetypes.test(file.originalname.toLowerCase().split(".").pop())
      : false;

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(
        new Error(
          "File type not supported. Only images, videos, audio, and documents are allowed."
        )
      );
    }
  },
});

router.get("/recent", authMiddleware, chatController.getRecentChats);

// Route để upload file
router.post(
  "/upload",
  authMiddleware,
  (req, res, next) => {
    console.log("Upload request received");
    upload.single("file")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              message: "File quá lớn. Kích thước tối đa là 50MB.",
            });
          }
          return res.status(400).json({ message: err.message });
        }
        return res
          .status(500)
          .json({ message: "File upload failed", error: err.message });
      }
      console.log("File processed by multer successfully");
      if (!req.file) {
        console.error("No file in request after multer processing");
      }
      next();
    });
  },
  chatController.uploadFile
);

// Route đặc biệt để upload video trực tiếp lên Cloudinary
router.post(
  "/cloudinary-video-upload",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      console.log("Processing video upload request to Cloudinary");

      if (!req.file) {
        return res.status(400).json({ message: "No video file provided" });
      }

      const file = req.file;
      console.log(
        `Processing video: ${file.originalname}, size: ${file.size} bytes, type: ${file.mimetype}`
      );

      // Kiểm tra loại file video
      if (!file.mimetype.startsWith("video/")) {
        return res.status(400).json({
          message:
            "Invalid file type. Only videos are allowed for this endpoint",
        });
      }

      const folder = req.body.folder || "italk_app_videos";

      // Tạo upload stream trực tiếp từ buffer
      const cloudinary = require("../config/cloudinaryConfig");

      // Chuyển buffer thành base64
      const base64Video = `data:${file.mimetype};base64,${file.buffer.toString(
        "base64"
      )}`;

      // Upload lên cloudinary với các option đặc biệt cho video
      const result = await cloudinary.uploader.upload(base64Video, {
        resource_type: "video",
        folder: folder,
        chunk_size: 6000000, // 6MB chunks để tránh timeout
        eager: [
          {
            format: "mp4",
            transformation: [{ quality: "auto", fetch_format: "mp4" }],
          },
          { height: 480, width: 640, crop: "pad" },
        ],
        eager_async: true,
        eager_notification_url: `${req.protocol}://${req.get(
          "host"
        )}/api/chat/cloudinary-notification`,
      });

      console.log(
        "Video uploaded successfully to Cloudinary:",
        result.secure_url
      );

      return res.status(200).json({
        url: result.secure_url,
        public_id: result.public_id,
        resource_type: result.resource_type,
        format: result.format,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        duration: result.duration,
      });
    } catch (error) {
      console.error("Error uploading video to Cloudinary:", error);
      return res.status(500).json({
        message: "Failed to upload video to Cloudinary",
        error: error.message,
      });
    }
  }
);

// Route đặc biệt để upload file lên Cloudinary
router.post(
  "/cloudinary-file-upload",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      console.log("Processing file upload request to Cloudinary");

      if (!req.file) {
        return res.status(400).json({ message: "No file provided" });
      }

      const file = req.file;
      console.log(
        `Processing file: ${file.originalname}, size: ${file.size} bytes, type: ${file.mimetype}`
      );

      const folder = req.body.folder || "italk_app_files";
      const resourceType = req.body.resource_type || "raw";

      // Tạo upload stream trực tiếp từ buffer
      const cloudinary = require("../config/cloudinaryConfig");

      // Chuyển buffer thành base64
      const base64File = `data:${file.mimetype};base64,${file.buffer.toString(
        "base64"
      )}`;

      // Upload lên cloudinary
      const result = await cloudinary.uploader.upload(base64File, {
        resource_type: resourceType,
        folder: folder,
        use_filename: true,
        unique_filename: true,
      });

      console.log(
        "File uploaded successfully to Cloudinary:",
        result.secure_url
      );

      return res.status(200).json({
        url: result.secure_url,
        public_id: result.public_id,
        resource_type: result.resource_type,
        format: result.format,
        bytes: result.bytes,
      });
    } catch (error) {
      console.error("Error uploading file to Cloudinary:", error);
      return res.status(500).json({
        message: "Failed to upload file to Cloudinary",
        error: error.message,
      });
    }
  }
);

// Endpoint để nhận thông báo khi video xử lý xong (eager transformations)
router.post("/cloudinary-notification", (req, res) => {
  console.log("Notification received from Cloudinary:", req.body);
  res.status(200).send("OK");
});

// Route to upload image directly to Cloudinary
router.post(
  "/upload-cloudinary",
  authMiddleware,
  chatController.uploadToCloudinary
);

// Development route for testing Cloudinary uploads (no auth required)
router.post("/test-cloudinary-upload", chatController.uploadToCloudinary);

router.get("/media/:fileId", chatController.getMedia);
router.delete("/media/:fileId", authMiddleware, chatController.deleteMedia);

// Route để lấy tin nhắn giữa 2 người dùng - đặt trước route chung
router.get(
  "/messages/:userId1/:userId2",
  authMiddleware,
  chatController.getMessagesBetweenUsers
);

// Route để lấy tin nhắn trong một phòng
router.get("/messages/:roomId", authMiddleware, chatController.getMessages);

// Route để lưu tin nhắn
router.post("/messages", authMiddleware, chatController.saveMessageRoute);

// Route để thu hồi tin nhắn
router.put(
  "/message/:messageId/unsend",
  authMiddleware,
  chatController.unsendMessage
);

// Route để xóa cuộc trò chuyện
router.delete(
  "/conversation/:userId1/:userId2",
  authMiddleware,
  chatController.deleteConversation
);

// Route xử lý phản ứng tin nhắn
router.post(
  "/message/:messageId/reaction",
  authMiddleware,
  chatController.addReaction
);
router.delete(
  "/message/:messageId/reaction",
  authMiddleware,
  chatController.removeReaction
);

// Endpoint kiểm tra trạng thái cuộc trò chuyện
router.get("/status/:userId", authMiddleware, (req, res) => {
  res.json({ status: "online" });
});

// Xử lý lỗi upload
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: "File quá lớn. Kích thước tối đa là 50MB.",
      });
    }
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

module.exports = router;
