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
    fileSize: 50 * 1024 * 1024, // Tăng giới hạn lên 50MB
  },
  fileFilter: function (req, file, cb) {
    // Kiểm tra loại file (tùy chọn)
    const filetypes =
      /jpeg|jpg|png|gif|mp4|mp3|m4a|wav|aac|pdf|doc|docx|xls|xlsx|zip/;
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

// Route to upload file
router.post(
  "/upload",
  authMiddleware,
  (req, res, next) => {
    console.log("Upload request received");
    console.log("Request content type:", req.headers["content-type"]);
    console.log("Request body keys:", Object.keys(req.body || {}));
    console.log(
      "Request has files via express-fileupload:",
      req.files ? "Yes" : "No"
    );

    // Special handling for express-fileupload
    if (req.files && req.files.file) {
      console.log("Found file in req.files (express-fileupload)");
      console.log("File details:", {
        name: req.files.file.name,
        size: req.files.file.size,
        mimetype: req.files.file.mimetype,
      });

      // Skip multer and go straight to controller
      req.file = {
        originalname: req.files.file.name,
        mimetype: req.files.file.mimetype,
        size: req.files.file.size,
        buffer: req.files.file.data,
      };

      return next();
    }

    // If we don't have files from express-fileupload, try with multer
    console.log("Processing with multer...");
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
        return res.status(400).json({ message: "No file uploaded" });
      }
      next();
    });
  },
  chatController.uploadFile
);

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

// Enhanced message reaction routes
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

// Hide message for current user only
router.post(
  "/message/:messageId/hide",
  authMiddleware,
  chatController.hideMessageForMe
);

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

// Endpoint kiểm tra trạng thái cuộc trò chuyện
router.get("/status/:userId", authMiddleware, (req, res) => {
  res.json({ status: "online" });
});

// Add this route for message reactions
router.post(
  "/messages/:messageId/reactions",
  authMiddleware,
  chatController.addReaction
);
router.delete(
  "/messages/:messageId/reactions/:emoji",
  authMiddleware,
  chatController.removeReaction
);

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
