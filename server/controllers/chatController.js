const Message = require("../Models/messageModels");
const User = require("../Models/userModel");
const mongoose = require("mongoose");
const { GridFSBucket, ObjectId } = require("mongodb");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");
const cloudinary = require("../config/cloudinaryConfig");

// Promisify exec để sử dụng async/await
const execAsync = promisify(exec);

// Kết nối với GridFS
let gfs;

// Đảm bảo kết nối MongoDB trước khi sử dụng GridFS
const ensureGridFSConnection = () => {
  return new Promise((resolve, reject) => {
    if (gfs) {
      return resolve(gfs);
    }

    // Kiểm tra kết nối MongoDB
    if (mongoose.connection.readyState !== 1) {
      console.log("MongoDB connection not ready, waiting...");
      // Thiết lập timeout để tránh chờ vô hạn
      const timeout = setTimeout(() => {
        reject(new Error("MongoDB connection timeout"));
      }, 5000);

      // Lắng nghe sự kiện kết nối thành công
      mongoose.connection.once("connected", () => {
        clearTimeout(timeout);
        console.log("MongoDB connected, initializing GridFS bucket");
        gfs = new GridFSBucket(mongoose.connection.db, {
          bucketName: "uploads",
        });
        resolve(gfs);
      });
    } else {
      // Nếu đã kết nối, khởi tạo GridFS
      console.log("MongoDB already connected, initializing GridFS bucket");
      gfs = new GridFSBucket(mongoose.connection.db, {
        bucketName: "uploads",
      });
      resolve(gfs);
    }
  });
};

// Khởi tạo bucket GridFS
mongoose.connection.once("open", () => {
  console.log("MongoDB connection open event triggered");
  gfs = new GridFSBucket(mongoose.connection.db, {
    bucketName: "uploads",
  });
  console.log("GridFS bucket initialized");
});

// Thời gian sống của file (7 ngày = 604800000 ms)
const FILE_EXPIRY_TIME = 7 * 24 * 60 * 60 * 1000; // 7 ngày

const saveMessage = async ({
  roomId,
  senderId,
  receiver,
  content,
  type = "text",
  tempId,
  replyTo,
  fileUrl,
  fileName,
  fileSize,
  fileThumbnail,
  fileId,
  expiryDate,
}) => {
  try {
    const message = new Message({
      roomId,
      sender: senderId,
      receiver,
      content,
      type,
      ...(replyTo && { replyTo }),
      ...(fileUrl && { fileUrl }),
      ...(fileName && { fileName }),
      ...(fileSize && { fileSize }),
      ...(fileThumbnail && { fileThumbnail }),
      ...(fileId && { fileId }),
      ...(expiryDate && { expiryDate }),
    });
    await message.save();

    return message;
  } catch (error) {
    console.error("Error saving message:", error);
    throw error;
  }
};

// Thêm hàm xử lý route để lưu tin nhắn
const saveMessageRoute = async (req, res) => {
  const {
    roomId,
    content,
    type,
    receiver,
    replyToId,
    fileUrl,
    fileName,
    fileSize,
    fileThumbnail,
    fileId,
    expiryDate,
  } = req.body;
  const senderId = req.user._id;

  try {
    // Xử lý nếu có replyToId
    let replyTo = null;
    if (replyToId) {
      const replyMessage = await Message.findById(replyToId);
      if (replyMessage) {
        replyTo = {
          _id: replyMessage._id,
          content: replyMessage.content,
          sender: replyMessage.sender,
        };
      }
    }

    const message = await saveMessage({
      roomId,
      senderId,
      receiver,
      content,
      type,
      replyTo,
      fileUrl,
      fileName,
      fileSize,
      fileThumbnail,
      fileId,
      expiryDate,
    });

    res.status(201).json(message);
  } catch (error) {
    console.error("Error saving message:", error);
    res
      .status(500)
      .json({ message: "Error saving message", error: error.message });
  }
};

// Hàm xử lý upload file vào MongoDB GridFS
const uploadFile = async (req, res) => {
  try {
    console.log("Upload file request received");
    console.log("Content-Type:", req.headers["content-type"]);

    // Kiểm tra xem có file trong request không
    if (!req.file && (!req.files || !req.files.file)) {
      return res
        .status(400)
        .json({ message: "Không có file nào được gửi lên" });
    }

    let file = req.file;

    // Nếu không có req.file nhưng có req.files (từ express-fileupload)
    if (!file && req.files && req.files.file) {
      console.log("Using file from express-fileupload");
      file = {
        originalname: req.files.file.name,
        mimetype: req.files.file.mimetype,
        size: req.files.file.size,
        buffer: req.files.file.data,
      };
    }

    console.log("Upload file details:", {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      hasBuffer: !!file.buffer,
    });

    // Đảm bảo GridFS đã được khởi tạo
    await ensureGridFSConnection();

    // Chuẩn bị metadata cho file
    const metadata = {
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      uploadedBy: req.user ? req.user._id : "anonymous",
      uploadDate: new Date(),
      senderId: req.body.senderId,
      receiverId: req.body.receiverId,
      type: req.body.type || "file",
    };

    // Tạo unique filename
    const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${
      file.originalname
    }`;

    // Tạo writeStream để ghi file vào GridFS
    const writeStream = gfs.openUploadStream(uniqueFilename, {
      metadata: metadata,
    });

    // Tạo promise để theo dõi quá trình upload
    const uploadPromise = new Promise((resolve, reject) => {
      writeStream.on("finish", function (file) {
        resolve(file);
      });

      writeStream.on("error", function (error) {
        console.error("GridFS upload stream error:", error);
        reject(error);
      });
    });

    // Ghi buffer vào GridFS
    try {
      if (!file.buffer) {
        return res.status(400).json({
          message: "File buffer is missing",
        });
      }

      writeStream.write(file.buffer);
      writeStream.end();
    } catch (writeError) {
      console.error("Error writing to GridFS stream:", writeError);
      return res.status(500).json({
        message: "Lỗi khi ghi dữ liệu vào GridFS",
        error: writeError.message,
      });
    }

    // Đợi quá trình upload hoàn tất
    const uploadedFile = await uploadPromise;

    console.log("File uploaded to GridFS:", uploadedFile);

    // Tạo URL cho file
    const fileUrl = `${req.protocol}://${req.get("host")}/api/chat/media/${
      uploadedFile._id
    }`;

    // Thông tin về file đã upload
    const fileInfo = {
      fileName: file.originalname || "untitled",
      fileUrl: fileUrl,
      fileSize: file.size || 0,
      fileMimeType: file.mimetype || "application/octet-stream",
      fileId: uploadedFile._id.toString(),
    };

    console.log("File uploaded successfully:", fileInfo);

    // Trả về thông tin file đã upload
    return res.status(200).json({
      message: "Upload thành công",
      ...fileInfo,
    });
  } catch (error) {
    console.error("Error in uploadFile:", error);
    return res.status(500).json({
      message: "Lỗi khi upload file",
      error: error.message || error,
    });
  }
};

// Hàm lấy media từ GridFS
const getMedia = async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.fileId);

    // Tìm file trong GridFS
    const files = await gfs.find({ _id: fileId }).toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({ message: "File không tồn tại" });
    }

    const file = files[0];

    // Kiểm tra xem file đã hết hạn chưa
    if (
      file.metadata &&
      file.metadata.expiryDate &&
      new Date(file.metadata.expiryDate) < new Date()
    ) {
      // Xóa file đã hết hạn
      await gfs.delete(fileId);
      return res.status(404).json({ message: "File đã hết hạn và bị xóa" });
    }

    // Set header content-type
    res.set(
      "Content-Type",
      file.metadata?.mimetype || "application/octet-stream"
    );

    // Set tên file gốc cho header Content-Disposition để tải về với tên gốc
    if (file.metadata?.originalName) {
      res.set(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(file.metadata.originalName)}"`
      );
    }

    // Tạo stream để đọc file từ GridFS
    const downloadStream = gfs.openDownloadStream(fileId);

    // Pipe stream vào response
    downloadStream.pipe(res);
  } catch (error) {
    console.error("Error retrieving file:", error);
    res
      .status(500)
      .json({ message: "Error retrieving file", error: error.message });
  }
};

// Hàm xóa media từ GridFS
const deleteMedia = async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.fileId);

    // Xóa file từ GridFS
    await gfs.delete(fileId);

    res.status(200).json({ message: "File đã được xóa thành công" });
  } catch (error) {
    console.error("Error deleting file:", error);
    res
      .status(500)
      .json({ message: "Error deleting file", error: error.message });
  }
};

// Hàm chạy định kỳ để xóa các file hết hạn
const cleanupExpiredFiles = async () => {
  try {
    console.log("Đang kiểm tra và xóa các file đã hết hạn...");

    const currentDate = new Date();
    const files = await gfs
      .find({ "metadata.expiryDate": { $lt: currentDate } })
      .toArray();

    console.log(`Tìm thấy ${files.length} file đã hết hạn`);

    for (const file of files) {
      try {
        await gfs.delete(file._id);
        console.log(`Đã xóa file ${file.filename} (ID: ${file._id})`);
      } catch (err) {
        console.error(`Lỗi khi xóa file ${file._id}:`, err);
      }
    }

    // Cập nhật trạng thái của các tin nhắn có file đã hết hạn
    await Message.updateMany(
      { fileId: { $in: files.map((file) => file._id.toString()) } },
      { $set: { fileExpired: true } }
    );

    console.log("Hoàn tất xóa file hết hạn");
  } catch (error) {
    console.error("Error cleaning up expired files:", error);
  }
};

// Thêm hàm tìm tin nhắn theo ID
const findMessageById = async (messageId) => {
  try {
    return await Message.findById(messageId);
  } catch (error) {
    console.error("Error finding message by ID:", error);
    throw error;
  }
};

// Hide message for current user only
exports.hideMessageForMe = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Add user to hiddenFor array if not already there
    if (!message.hiddenFor.includes(userId)) {
      message.hiddenFor.push(userId);
      await message.save();
    }

    return res.status(200).json({
      message: "Message hidden successfully",
    });
  } catch (error) {
    console.error("Error hiding message:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Update existing unsend message function
exports.unsendMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    console.log(
      `API unsendMessage called for messageId=${messageId}, userId=${userId}`
    );

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      console.error(`Message not found: ${messageId}`);
      return res.status(404).json({ message: "Message not found" });
    }

    // Validate sender - convert to string for proper comparison
    if (message.sender.toString() !== userId.toString()) {
      console.log(
        `Unauthorized unsend attempt: Message sender=${message.sender}, requester=${userId}`
      );
      return res
        .status(403)
        .json({ message: "You can only unsend your own messages" });
    }

    console.log(
      `Unsending message ${messageId}. Original type: ${message.type}`
    );

    // Store original message type and content for reference
    const originalType = message.type;
    const originalContent = message.content;

    // Mark message as unsent
    message.isUnsent = true;
    message.unsent = true; // For backward compatibility with different field names
    message.content = "This message has been unsent";

    // Properly handle different message types
    if (message.type !== "text") {
      console.log(
        `Clearing file data for ${message.type} message with fileUrl: ${message.fileUrl}`
      );
      // Store original file data in a new field for reference if needed
      message.originalFileUrl = message.fileUrl;
      message.originalFileName = message.fileName;
      message.originalFileThumbnail = message.fileThumbnail;

      // Clear all file-related data
      message.fileUrl = null;
      message.fileName = null;
      message.fileThumbnail = null;
      message.fileSize = null;

      // Keep the original type for reference
      message.originalType = originalType;
      message.type = "unsent";
    }

    await message.save();
    console.log(`Message ${messageId} marked as unsent successfully`);

    return res.status(200).json({
      message: "Message unsent successfully",
      updatedMessage: message,
    });
  } catch (error) {
    console.error("Error unsending message:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Separate socket handler for unsending messages
exports.unsendMessageSocket = async (data) => {
  try {
    const { messageId, senderId } = data;
    if (!messageId || !senderId) {
      console.error("Missing required fields for unsending message");
      return null;
    }

    console.log(
      `Socket unsendMessageSocket called for messageId=${messageId}, senderId=${senderId}`
    );

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      console.error("Message not found for unsending:", messageId);
      return null;
    }

    // Validate sender
    if (message.sender.toString() !== senderId.toString()) {
      console.error(
        `Unauthorized unsend: Message sender=${message.sender}, requester=${senderId}`
      );
      return null;
    }

    console.log(
      `Processing unsend for message type: ${message.type}, sender: ${senderId}`
    );

    // Store original message type and content
    const originalType = message.type;
    const originalContent = message.content;

    // Mark message as unsent
    message.isUnsent = true;
    message.unsent = true; // For backward compatibility
    message.content = "This message has been unsent";

    // Handle different message types
    if (message.type !== "text") {
      console.log(
        `Clearing file data for ${message.type} message with fileUrl: ${message.fileUrl}`
      );
      // Store original file data in separate fields
      message.originalFileUrl = message.fileUrl;
      message.originalFileName = message.fileName;
      message.originalFileThumbnail = message.fileThumbnail;

      // Clear file data
      message.fileUrl = null;
      message.fileName = null;
      message.fileThumbnail = null;
      message.fileSize = null;

      // Keep the original type for reference
      message.originalType = originalType;
      message.type = "unsent";
    }

    await message.save();
    console.log(`Message ${messageId} unsent via socket`);

    return message;
  } catch (error) {
    console.error("Error in unsendMessageSocket:", error);
    return null;
  }
};

const getMessages = async (req, res) => {
  const { roomId } = req.params;

  try {
    const messages = await Message.find({ roomId })
      .populate("sender", "name avt")
      .sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ message: "Error fetching messages", error });
  }
};

const getMessagesBetweenUsers = async (req, res) => {
  const { userId1, userId2 } = req.params;

  try {
    // Tạo roomId từ userIds đã sắp xếp
    const userIds = [userId1, userId2].sort();
    const roomId = `${userIds[0]}_${userIds[1]}`;

    // Tìm tin nhắn dựa vào roomId
    const messages = await Message.find({
      roomId: roomId,
    })
      .populate("sender", "name avt")
      .sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages between users:", error);
    res.status(500).json({
      message: "Không thể tải tin nhắn giữa hai người dùng",
      error,
    });
  }
};

// Xóa toàn bộ tin nhắn trong cuộc trò chuyện hoặc ẩn tin nhắn cho một người dùng
const deleteConversation = async (req, res) => {
  try {
    const { userId1, userId2 } = req.params;
    const requesterId = req.user._id.toString();

    // Kiểm tra xem người dùng có phải là một trong hai người dùng trong cuộc trò chuyện
    if (requesterId !== userId1 && requesterId !== userId2) {
      return res
        .status(403)
        .json({ message: "Bạn không có quyền xóa cuộc trò chuyện này" });
    }

    // Tạo roomId từ hai userId (đã sắp xếp)
    const userIds = [userId1, userId2].sort();
    const roomId = `${userIds[0]}_${userIds[1]}`;

    // Nếu chỉ xóa tin nhắn của một phía
    if (req.query.forCurrentUser === "true") {
      console.log(
        `Hiding all messages in room ${roomId} for user ${requesterId}`
      );

      // Tìm tất cả tin nhắn trong phòng
      const messages = await Message.find({ roomId });

      // Cập nhật từng tin nhắn để thêm người dùng vào mảng hiddenFor
      for (const message of messages) {
        if (!message.hiddenFor) {
          message.hiddenFor = [];
        }

        if (!message.hiddenFor.includes(requesterId)) {
          message.hiddenFor.push(requesterId);
          await message.save();
        }
      }

      return res.status(200).json({
        message: "Tin nhắn đã được ẩn cho bạn",
        count: messages.length,
      });
    } else {
      // Nếu xóa toàn bộ cuộc trò chuyện (cả hai bên đồng ý)
      console.log(`Permanently deleting all messages in room ${roomId}`);
      const result = await Message.deleteMany({ roomId });

      return res.status(200).json({
        message: "Xóa cuộc trò chuyện thành công",
        count: result.deletedCount,
      });
    }
  } catch (error) {
    console.error("Lỗi khi xóa cuộc trò chuyện:", error);
    return res
      .status(500)
      .json({ message: "Lỗi khi xóa cuộc trò chuyện", error: error.message });
  }
};

// Hàm để lấy danh sách cuộc trò chuyện gần đây
const getRecentChats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Tìm tất cả tin nhắn mà người dùng này có liên quan
    const results = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: new mongoose.Types.ObjectId(userId) },
            { receiver: new mongoose.Types.ObjectId(userId) },
          ],
          isDeleted: { $ne: true },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: "$roomId",
          lastMessage: { $first: "$$ROOT" },
          updatedAt: { $max: "$createdAt" },
        },
      },
      {
        $sort: { updatedAt: -1 },
      },
    ]);

    // Lấy danh sách người dùng liên quan đến các cuộc trò chuyện
    const chatList = [];
    for (const chat of results) {
      // Xác định ID người dùng khác trong cuộc trò chuyện
      const roomUsers = chat._id.split("_");
      const otherUserId = roomUsers[0] === userId ? roomUsers[1] : roomUsers[0];

      // Lấy thông tin người dùng
      const otherUser = await User.findById(otherUserId).select(
        "name avt email"
      );

      if (otherUser) {
        // Đếm số tin nhắn chưa đọc
        const unreadCount = await Message.countDocuments({
          roomId: chat._id,
          receiver: userId,
          isRead: false,
          isDeleted: { $ne: true },
        });

        // Tạo đối tượng chat
        chatList.push({
          id: chat._id,
          isGroup: false,
          participants: [
            {
              id: userId,
              firstName: req.user.name.split(" ")[0],
              lastName: req.user.name.split(" ")[1] || "",
              avatar: req.user.avt,
            },
            {
              id: otherUser._id,
              firstName: otherUser.name.split(" ")[0],
              lastName: otherUser.name.split(" ")[1] || "",
              avatar: otherUser.avt,
              email: otherUser.email,
            },
          ],
          lastMessage: {
            id: chat.lastMessage._id,
            content: chat.lastMessage.content,
            type: chat.lastMessage.type || "text",
            senderId: chat.lastMessage.sender,
            createdAt: chat.lastMessage.createdAt,
            isRead: chat.lastMessage.isRead,
          },
          unreadCount: unreadCount,
          updatedAt: chat.updatedAt,
        });
      }
    }

    res.json(chatList);
  } catch (error) {
    console.error("Error fetching recent chats:", error);
    res.status(500).json({ message: "Lỗi khi lấy danh sách cuộc trò chuyện" });
  }
};

// Thiết lập chạy cleanup mỗi 24 giờ
setInterval(cleanupExpiredFiles, 24 * 60 * 60 * 1000);
// Chạy ngay lập tức khi khởi động server
setTimeout(cleanupExpiredFiles, 5000);

// Enhanced Cloudinary upload function to handle all media types
exports.uploadToCloudinary = async (req, res) => {
  try {
    console.log(
      "Upload request received, content type:",
      req.headers["content-type"]
    );
    console.log("Request files:", req.files ? Object.keys(req.files) : "None");
    console.log(
      "Request body:",
      typeof req.body === "object" ? Object.keys(req.body) : typeof req.body
    );

    // Check if we received files via express-fileupload
    if (!req.files || Object.keys(req.files).length === 0) {
      console.log(
        "No files found in req.files. Checking if image was sent in body..."
      );

      // Check if image was sent as base64 in the body
      if (req.body && req.body.image) {
        console.log("Found base64 image in request body");

        // Handle base64 image upload
        const base64Data = req.body.image;
        const uploadOptions = {
          resource_type: "image",
          folder: req.body.folder || "iTalkConnectPlus/images",
          public_id: `image_${Date.now()}`,
          overwrite: true,
        };

        console.log("Uploading base64 image to Cloudinary...");
        const result = await cloudinary.uploader.upload(
          base64Data,
          uploadOptions
        );

        return res.status(200).json({
          success: true,
          message: "Base64 image uploaded successfully",
          url: result.secure_url,
          file: {
            fileId: result.public_id,
            fileUrl: result.secure_url,
            fileName: "image.jpg",
            fileSize: result.bytes,
            fileType: "image",
            fileThumbnail:
              result.eager && result.eager[1]
                ? result.eager[1].secure_url
                : null,
            width: result.width,
            height: result.height,
            format: result.format,
          },
        });
      }

      return res.status(400).json({ message: "No files were uploaded" });
    }

    const file = req.files.file;
    console.log("File received:", {
      name: file.name,
      size: file.size,
      mimetype: file.mimetype,
      tempFilePath: file.tempFilePath || "No temp file path",
      md5: file.md5 || "No MD5",
    });

    const fileType = getFileType(file.mimetype);
    console.log("Detected file type:", fileType);

    // For document files, make sure they're handled correctly
    let resourceType = getResourceType(fileType);

    // Special handling for PDFs and documents
    if (fileType === "file") {
      if (file.mimetype === "application/pdf") {
        console.log(
          "Treating PDF as image resource type for Cloudinary compatibility"
        );
        resourceType = "image"; // PDFs can be processed as images in Cloudinary
      } else {
        console.log("Using raw resource type for document");
        resourceType = "raw"; // Use raw for other documents
      }
    }

    // Configure upload options based on file type
    const uploadOptions = {
      resource_type: resourceType,
      folder: `iTalkConnectPlus/${fileType}s`,
      public_id: `${fileType}_${Date.now()}`,
      overwrite: true,
    };

    console.log("Cloudinary upload options:", uploadOptions);

    // Verify the file exists on disk before uploading
    if (file.tempFilePath) {
      const fs = require("fs");
      const exists = fs.existsSync(file.tempFilePath);
      console.log(`Temp file exists at ${file.tempFilePath}: ${exists}`);

      if (!exists) {
        return res.status(400).json({
          message: "Temporary file does not exist on server",
        });
      }

      const stats = fs.statSync(file.tempFilePath);
      console.log(
        `Temp file stats: size=${stats.size}, isFile=${stats.isFile()}`
      );
    }

    // Upload to Cloudinary
    console.log(`Starting Cloudinary upload for ${fileType} file...`);

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        file.tempFilePath,
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error("Cloudinary upload error:", error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
    });

    console.log("Cloudinary upload result:", result.secure_url);

    // Create response object with all necessary info for frontend
    const fileData = {
      fileId: result.public_id,
      fileUrl: result.secure_url,
      fileName: file.name,
      fileSize: file.size,
      fileType: fileType,
      fileThumbnail:
        result.eager && result.eager[1] ? result.eager[1].secure_url : null,
      width: result.width,
      height: result.height,
      format: result.format,
      duration: result.duration || null,
    };

    // Clean up temp file
    try {
      if (file.tempFilePath) {
        fs.unlinkSync(file.tempFilePath);
        console.log("Temp file cleaned up");
      }
    } catch (cleanupError) {
      console.error("Error cleaning up temp file:", cleanupError);
      // Continue anyway since the upload succeeded
    }

    return res.status(200).json({
      success: true,
      message: "File uploaded successfully",
      file: fileData,
    });
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    console.error("Error stack:", error.stack);
    return res.status(500).json({
      message: "Error uploading file to Cloudinary",
      error: error.message,
    });
  }
};

// Helper function to determine file type
function getFileType(mimetype) {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "file";
}

// Helper function to determine Cloudinary resource type
function getResourceType(fileType) {
  if (fileType === "image") return "image";
  if (fileType === "video") return "video";
  if (fileType === "audio") return "video"; // Audio uses the video resource type in Cloudinary
  if (fileType === "file") return "raw"; // Document files use raw resource type
  return "auto"; // Default to auto detection
}

// Function to save message with attached file
exports.saveMessageWithAttachment = async (messageData) => {
  try {
    const {
      sender,
      receiver,
      roomId,
      fileData,
      chatType = "private",
      groupId = null,
    } = messageData;

    if (!fileData) {
      throw new Error("File data is required");
    }

    // Create a new message with file data
    const message = new Message({
      sender,
      receiver: chatType === "private" ? receiver : null,
      groupId: chatType === "group" ? groupId : null,
      roomId,
      content: fileData.fileName || "Attachment",
      type: fileData.fileType || "file",
      fileUrl: fileData.fileUrl,
      fileName: fileData.fileName,
      fileSize: fileData.fileSize,
      fileThumbnail: fileData.fileThumbnail,
      fileId: fileData.fileId,
      chatType,
      status: "sent",
    });

    // Save the message
    await message.save();

    // Populate sender details
    await message.populate("sender", "firstName lastName email profileImage");

    return message;
  } catch (error) {
    console.error("Error saving message with attachment:", error);
    throw error;
  }
};

// Add/update reaction to a message
exports.addReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id.toString();

    if (!emoji) {
      return res.status(400).json({ message: "Emoji is required" });
    }

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Ensure reactions is an object
    if (!message.reactions) {
      message.reactions = {};
    }

    // Check if user already reacted with this emoji
    const currentReaction = message.reactions[userId];

    if (currentReaction === emoji) {
      // User already used this emoji, so remove it (toggle behavior)
      delete message.reactions[userId];
      console.log(`Removed reaction ${emoji} from user ${userId}`);
    } else {
      // Add or change the user's reaction
      message.reactions[userId] = emoji;
      console.log(`Added/updated reaction ${emoji} from user ${userId}`);
    }

    await message.save();

    console.log(
      `Updated message reactions via HTTP: ${JSON.stringify(message.reactions)}`
    );

    return res.status(200).json({
      message: "Reaction updated successfully",
      reactions: message.reactions,
    });
  } catch (error) {
    console.error("Error adding reaction:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Remove a specific reaction
exports.removeReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id.toString();

    if (!emoji) {
      return res.status(400).json({ message: "Emoji is required" });
    }

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Check if reactions object exists
    if (!message.reactions) {
      return res
        .status(404)
        .json({ message: "No reactions found for this message" });
    }

    // Check if the user has reacted with this emoji
    if (message.reactions[userId] === emoji) {
      // Remove the reaction
      delete message.reactions[userId];
      console.log(`Removed reaction from user ${userId}`);

      await message.save();

      return res.status(200).json({
        message: "Reaction removed successfully",
        reactions: message.reactions,
      });
    } else {
      return res
        .status(404)
        .json({ message: "You have not reacted with this emoji" });
    }
  } catch (error) {
    console.error("Error removing reaction:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Add/update reaction via socket (non-HTTP)
const addReactionSocket = async (messageId, userId, emoji) => {
  try {
    if (!messageId || !userId || !emoji) {
      console.error("Missing required fields for reaction");
      return null;
    }

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      console.error("Message not found for reaction:", messageId);
      return null;
    }

    // Ensure reactions is an object
    if (!message.reactions) {
      message.reactions = {};
    }

    // Check if user already reacted with this emoji
    const currentReaction = message.reactions[userId];

    if (currentReaction === emoji) {
      // User already used this emoji, so remove it (toggle behavior)
      delete message.reactions[userId];
      console.log(`Removed reaction ${emoji} from user ${userId}`);
    } else {
      // Add or change the user's reaction
      message.reactions[userId] = emoji;
      console.log(`Added/updated reaction ${emoji} from user ${userId}`);
    }

    await message.save();

    console.log(
      `Updated message reactions: ${JSON.stringify(message.reactions)}`
    );

    return message;
  } catch (error) {
    console.error("Error in addReactionSocket:", error);
    return null;
  }
};

exports.addReactionSocket = addReactionSocket;

exports.saveMessage = saveMessage;
exports.getMessages = getMessages;
exports.getMessagesBetweenUsers = getMessagesBetweenUsers;
exports.findMessageById = findMessageById;
exports.uploadFile = uploadFile;
exports.saveMessageRoute = saveMessageRoute;
exports.getMedia = getMedia;
exports.deleteMedia = deleteMedia;
exports.cleanupExpiredFiles = cleanupExpiredFiles;
exports.deleteConversation = deleteConversation;
exports.getRecentChats = getRecentChats;

// Socket-based function to hide message for current user
exports.hideMessageForMeSocket = async (data) => {
  try {
    const { messageId, userId } = data;
    if (!messageId || !userId) {
      console.error("Missing required fields for hiding message");
      return null;
    }

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      console.error("Message not found for hiding:", messageId);
      return null;
    }

    // Initialize hiddenFor array if not exists
    if (!message.hiddenFor) {
      message.hiddenFor = [];
    }

    // Add user to hiddenFor array if not already there
    if (!message.hiddenFor.includes(userId)) {
      message.hiddenFor.push(userId);
      await message.save();
      console.log(`Message ${messageId} hidden for user ${userId} via socket`);
    }

    return message;
  } catch (error) {
    console.error("Error in hideMessageForMeSocket:", error);
    return null;
  }
};

// Socket handler for deleting messages
exports.deleteConversationSocket = async (data) => {
  try {
    const { roomId, userId, forCurrentUserOnly = true } = data;

    if (!roomId || !userId) {
      console.error("Missing required fields for deleting conversation");
      return null;
    }

    // Check if this is a valid roomId
    if (!roomId.includes("_")) {
      console.error("Invalid room ID format");
      return null;
    }

    // If only hiding messages for current user
    if (forCurrentUserOnly) {
      console.log(`Hiding all messages in room ${roomId} for user ${userId}`);

      // Find all messages in the room
      const messages = await Message.find({ roomId });

      // Update each message to add user to hiddenFor array
      for (const message of messages) {
        if (!message.hiddenFor) {
          message.hiddenFor = [];
        }

        if (!message.hiddenFor.includes(userId)) {
          message.hiddenFor.push(userId);
          await message.save();
        }
      }

      return {
        success: true,
        message: "Messages hidden for current user",
        count: messages.length,
      };
    } else {
      // This is a permanent deletion - should be used with caution
      // Consider adding additional validation here
      console.log(`Permanently deleting all messages in room ${roomId}`);
      const result = await Message.deleteMany({ roomId });

      return {
        success: true,
        message: "Conversation deleted permanently",
        count: result.deletedCount,
      };
    }
  } catch (error) {
    console.error("Error in deleteConversationSocket:", error);
    return null;
  }
};
