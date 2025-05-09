const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const path = require("path");
const fileUpload = require("express-fileupload");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3005;
const uri = process.env.MONGO_URI;

// Kết nối MongoDB
mongoose
  .connect(uri)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

// Middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400,
  })
);
// Tăng giới hạn kích thước request body cho uploads
app.use(bodyParser.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ limit: "100mb", extended: true }));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// Cấu hình middleware express-fileupload
app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "/tmp/",
    limits: { fileSize: 100 * 1024 * 1024 }, // giới hạn 100MB
    abortOnLimit: false,
    debug: true,
    uploadTimeout: 300000, // tăng từ 60000 lên 300000 (5 phút)
    // Thêm các tùy chọn mới bên dưới
    parseNested: true,
    createParentPath: true,
    useTempFiles: true,
    safeFileNames: true,
  })
);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Health check API để client kiểm tra kết nối
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    serverTime: new Date().toLocaleTimeString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Routes API
const userRoute = require("./Routes/userRoute");
const friendshipRoute = require("./Routes/friendshipRoute");
const groupRoute = require("./Routes/groupRoute");
const chatRoute = require("./Routes/chatRoute");
const searchRoute = require("./Routes/searchRoute");

app.use("/api/auth", userRoute);
app.use("/api/user", userRoute);
app.use("/api/friendship", friendshipRoute);
app.use("/api/friends", friendshipRoute);
app.use("/api/groups", groupRoute);
app.use("/api/chat", chatRoute);
app.use("/api/search", searchRoute);

// Socket.IO
const chatController = require("./controllers/chatController");
const friendshipController = require("./controllers/friendshipController");
const groupChatController = require("./controllers/groupChatController");
const Group = require("./Models/groupModel");
const Message = require("./Models/messageModels");

// Thêm cài đặt ping timeout và thời gian chờ
io.engine.pingTimeout = 60000; // 60 giây
io.engine.pingInterval = 25000; // 25 giây

// Lưu trữ kết nối socket và trạng thái người dùng
const userSockets = new Map(); // userId -> socketId
const onlineUsers = new Set(); // danh sách userId đang online
let connectCounter = 0; // Đếm số lượng kết nối để giảm log

// Track processed message IDs to avoid duplicates
const processedMessages = new Map(); // tempId -> messageId

function isDuplicateMessage(data) {
  if (!data.tempId) return false;
  return processedMessages.has(data.tempId);
}

// Helper function to convert Map reactions to plain objects for client compatibility
const convertReactionsMapToObject = (message) => {
  if (message && message.reactions instanceof Map) {
    // Create a plain object from the Map
    const reactionsObject = {};
    for (const [emoji, reactions] of message.reactions.entries()) {
      reactionsObject[emoji] = reactions;
    }
    // Replace the Map with the plain object
    message.reactions = reactionsObject;
  }
  return message;
};

io.on("connection", (socket) => {
  // Chỉ log thông tin socket.id nếu cần thiết cho debug
  connectCounter++;
  if (connectCounter % 10 === 0) {
    console.log(
      `[Connection Stats] Total connections: ${connectCounter}, Active users: ${onlineUsers.size}`
    );
  }

  let currentUserId = null;
  let authenticated = false;

  // Lấy thông tin người dùng từ token
  const token = socket.handshake.auth.token;
  if (token) {
    try {
      // Giải mã token để lấy user._id
      const decoded = require("jsonwebtoken").verify(
        token,
        process.env.JWT_SECRET
      );
      const userId = decoded._id || decoded.id;

      if (userId) {
        authenticated = true;
        currentUserId = userId;
        console.log(`User ${userId} connected with socket ${socket.id}`);

        // Lưu socket id của người dùng
        userSockets.set(userId, socket.id);
        onlineUsers.add(userId);

        // Người dùng tham gia phòng riêng với ID của họ
        socket.join(userId);

        // Thông báo cho các người dùng khác biết người dùng này đã online
        socket.broadcast.emit("userOnline", userId);

        // Gửi danh sách người dùng đang online cho người vừa kết nối
        socket.emit("onlineUsers", Array.from(onlineUsers));

        // Tự động tham gia vào tất cả các phòng nhóm mà người dùng là thành viên
        joinUserGroups(userId, socket);
      }
    } catch (error) {
      console.error("Error authenticating socket connection:", error);
    }
  }

  // Hàm để tự động tham gia vào tất cả các nhóm của người dùng
  async function joinUserGroups(userId, socket) {
    try {
      // Tìm tất cả các nhóm mà người dùng là thành viên
      const groups = await Group.find({ members: userId });

      for (const group of groups) {
        const groupRoomId = `group:${group._id}`;
        socket.join(groupRoomId);
        console.log(`User ${userId} joined group room: ${groupRoomId}`);
      }
    } catch (error) {
      console.error(`Error joining user groups: ${error.message}`);
    }
  }

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  // Tham gia vào phòng nhóm
  socket.on("joinGroupRoom", (groupId) => {
    const groupRoomId = `group:${groupId}`;
    socket.join(groupRoomId);
    console.log(`User ${currentUserId} joined group room: ${groupRoomId}`);
  });

  // Sự kiện đang nhập
  socket.on("typing", (data) => {
    const { sender, receiver } = data;

    // Gửi thông báo đến người nhận nếu họ đang online
    if (userSockets.has(receiver)) {
      io.to(receiver).emit("userTyping", { userId: sender });
    }
  });

  socket.on("stopTyping", (data) => {
    const { sender, receiver } = data;

    // Gửi thông báo đến người nhận nếu họ đang online
    if (userSockets.has(receiver)) {
      io.to(receiver).emit("userStoppedTyping", { userId: sender });
    }
  });

  // Event đang nhập trong nhóm
  socket.on("typingInGroup", (data) => {
    const { senderId, groupId, senderName } = data;
    const groupRoomId = `group:${groupId}`;

    // Gửi thông báo đến tất cả thành viên trong nhóm (trừ người gửi)
    socket.to(groupRoomId).emit("userTypingInGroup", {
      userId: senderId,
      groupId,
      userName: senderName,
    });
  });

  socket.on("stopTypingInGroup", (data) => {
    const { senderId, groupId } = data;
    const groupRoomId = `group:${groupId}`;

    // Gửi thông báo đến tất cả thành viên trong nhóm (trừ người gửi)
    socket.to(groupRoomId).emit("userStoppedTypingInGroup", {
      userId: senderId,
      groupId,
    });
  });

  socket.on("sendFriendRequest", (data) => {
    const { recipientId, requesterId } = data;
    io.to(recipientId).emit("friendRequestReceived", { requesterId });
    console.log(`Friend request sent from ${requesterId} to ${recipientId}`);
  });

  // Socket events cho chức năng kết bạn
  socket.on("friendRequest", (data) => {
    const { requesterId, recipientId, requesterName, friendshipId } = data;

    // Thêm log để debug
    console.log(
      `Socket: Yêu cầu kết bạn từ ${requesterId} (${requesterName}) đến ${recipientId}`
    );

    // Nếu người nhận đang online, gửi thông báo tới người nhận
    if (userSockets.has(recipientId)) {
      io.to(recipientId).emit("friendRequestReceived", {
        friendshipId,
        requesterId,
        recipientId,
        requesterName,
      });
      console.log(`Đã gửi thông báo yêu cầu kết bạn tới ${recipientId}`);
    } else {
      console.log(
        `Người dùng ${recipientId} không online, không gửi thông báo trực tiếp`
      );
    }
  });

  socket.on("friendRequestAccepted", (data) => {
    const { requesterId, recipientId, friendshipId } = data;

    // Thêm log để debug
    console.log(`Socket: Yêu cầu kết bạn được chấp nhận: ${friendshipId}`);
    console.log(`Người gửi: ${requesterId}, Người nhận: ${recipientId}`);

    // Nếu người gửi yêu cầu ban đầu đang online, gửi thông báo
    if (userSockets.has(requesterId)) {
      io.to(requesterId).emit("friendRequestAccepted", {
        friendshipId,
        requesterId,
        recipientId,
      });
      console.log(`Đã gửi thông báo chấp nhận kết bạn tới ${requesterId}`);
    }

    // Gửi broadcast để cập nhật trạng thái ở tất cả clients
    io.emit("friendStatusUpdated", {
      users: [requesterId, recipientId],
      status: "friends",
    });
  });

  socket.on("friendRequestRejected", (data) => {
    const { requesterId, recipientId, friendshipId } = data;

    console.log(`Socket: Yêu cầu kết bạn bị từ chối: ${friendshipId}`);

    // Thông báo cho người gửi yêu cầu ban đầu nếu họ online
    if (userSockets.has(requesterId)) {
      io.to(requesterId).emit("friendRequestRejected", {
        friendshipId,
        requesterId,
        recipientId,
      });
      console.log(`Đã gửi thông báo từ chối kết bạn tới ${requesterId}`);
    }
  });

  // Gửi tin nhắn trong nhóm
  socket.on("sendGroupMessage", async (data) => {
    const {
      senderId,
      groupId,
      content,
      type = "text",
      tempId,
      replyToId,
      fileUrl,
      fileName,
      fileSize,
      fileThumbnail,
      fileId,
      expiryDate,
    } = data;

    try {
      // Check for duplicates
      if (isDuplicateMessage(data)) {
        console.log(
          `Skipping duplicate group message from ${senderId} with tempId ${tempId}`
        );
        return;
      }

      // Tạo roomId cho nhóm
      const roomId = `group:${groupId}`;

      // Kiểm tra xem người dùng có quyền gửi tin nhắn trong nhóm không
      const group = await Group.findById(groupId);
      if (!group) {
        throw new Error("Group not found");
      }

      if (!group.members.includes(senderId)) {
        throw new Error("You are not a member of this group");
      }

      // Tìm tin nhắn để trả lời nếu có
      let replyToData = null;
      if (replyToId) {
        const replyMessage = await chatController.findMessageById(replyToId);
        if (replyMessage) {
          replyToData = {
            _id: replyMessage._id,
            content: replyMessage.content,
            sender: replyMessage.sender,
          };
        }
      }

      // Lưu tin nhắn
      const message = await groupChatController.saveGroupMessage({
        roomId,
        groupId,
        senderId,
        content,
        type,
        tempId,
        replyTo: replyToData,
        fileUrl,
        fileName,
        fileSize,
        fileThumbnail,
        fileId,
        expiryDate,
      });

      // Store the real message ID with this tempId
      if (tempId && message._id) {
        processedMessages.set(tempId, {
          messageId: message._id,
          content,
          sender: senderId,
          timestamp: Date.now(),
        });
      }

      // Populate thông tin người gửi
      await message.populate("sender", "name avt");

      // Gửi tin nhắn đến tất cả thành viên trong nhóm
      io.to(roomId).emit("receiveGroupMessage", {
        ...message.toObject(),
        _tempId: tempId,
      });

      // Also emit as groupMessage for mobile clients
      io.to(roomId).emit("groupMessage", {
        ...message.toObject(),
        _tempId: tempId,
      });

      console.log(`Group message sent from ${senderId} to group ${groupId}`);
    } catch (error) {
      console.error("Error sending group message:", error);
      // Thông báo lỗi cho người gửi
      io.to(senderId).emit("groupMessageError", {
        tempId,
        groupId,
        error: error.message,
      });
    }
  });

  // Handler for generic message event (used by web client for group messages)
  socket.on("message", async (data) => {
    // Check if this is a group message
    if (data.room && data.room.startsWith("group:") && data.groupId) {
      // Check for duplicates
      if (isDuplicateMessage(data)) {
        console.log(
          `Skipping duplicate message event from ${
            data.sender || data.senderId
          } with tempId ${data.tempId}`
        );
        return;
      }

      // Extract groupId from room
      const groupId = data.groupId;
      const senderId = data.sender || currentUserId;

      try {
        // Get the room name from data or create it
        const roomId = data.room;

        // Check if user is a member of the group
        const group = await Group.findById(groupId);
        if (!group) {
          console.log(`Group not found: ${groupId}`);
          return;
        }

        if (!group.members.includes(senderId)) {
          console.log(`User ${senderId} is not a member of group ${groupId}`);
          return;
        }

        // Process reply data if exists
        let replyToData = null;
        if (data.replyToId) {
          const replyMessage = await chatController.findMessageById(
            data.replyToId
          );
          if (replyMessage) {
            replyToData = {
              _id: replyMessage._id,
              content: replyMessage.content,
              sender: replyMessage.sender,
            };
          }
        }

        // Save the message
        const message = await groupChatController.saveGroupMessage({
          roomId,
          groupId,
          senderId,
          content: data.content,
          type: data.type || "text",
          tempId: data.tempId,
          replyTo: replyToData,
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileThumbnail: data.fileThumbnail,
          fileId: data.fileId,
          expiryDate: data.expiryDate,
        });

        // Store the real message ID with this tempId
        if (data.tempId && message._id) {
          processedMessages.set(data.tempId, {
            messageId: message._id,
            content: data.content,
            sender: senderId,
            timestamp: Date.now(),
          });
        }

        // Populate sender information
        await message.populate("sender", "name avt");

        // Before emitting to clients, convert reactions
        const messageObj = message.toObject ? message.toObject() : message;
        const processedMessage = convertReactionsMapToObject(messageObj);

        // Emit to all members in the room with processed message
        io.to(roomId).emit("groupMessage", {
          ...processedMessage,
          _tempId: data.tempId,
        });

        // Also emit as receiveGroupMessage for web clients
        io.to(roomId).emit("receiveGroupMessage", {
          ...processedMessage,
          _tempId: data.tempId,
        });

        console.log(
          `Message event processed as group message from ${senderId} to group ${groupId}`
        );
      } catch (error) {
        console.error(
          "Error processing message event as group message:",
          error
        );
      }
    }
    // You can add handlers for other types of messages here if needed
  });

  // Reaction trong nhóm
  socket.on("addGroupReaction", async (data) => {
    const { messageId, userId, emoji, groupId } = data;

    try {
      // Lưu reaction vào cơ sở dữ liệu
      const message = await Message.findByIdAndUpdate(
        messageId,
        {
          $set: { [`reactions.${userId}`]: emoji },
        },
        { new: true }
      );

      if (!message) {
        throw new Error("Message not found");
      }

      const roomId = `group:${groupId}`;

      // Phát sóng reaction đến tất cả thành viên trong nhóm
      io.to(roomId).emit("groupMessageReaction", {
        messageId,
        userId,
        emoji,
        groupId,
      });

      console.log(
        `Group reaction from ${userId} for message ${messageId}: ${emoji} sent to room ${roomId}`
      );
    } catch (error) {
      console.error("Error adding group reaction:", error);
    }
  });

  // Xóa tin nhắn nhóm
  socket.on("deleteGroupMessage", async (data) => {
    const { messageId, userId, groupId } = data;

    try {
      // Thông báo cho tất cả thành viên trong nhóm
      const roomId = `group:${groupId}`;
      io.to(roomId).emit("groupMessageDeleted", {
        messageId,
        deletedBy: userId,
        groupId,
      });

      console.log(
        `Group message ${messageId} deleted by ${userId} in group ${groupId}`
      );
    } catch (error) {
      console.error("Error handling group message deletion:", error);
    }
  });

  // Events cho quản lý nhóm
  socket.on("memberAddedToGroup", async (data) => {
    const { groupId, memberId, addedBy } = data;

    try {
      const roomId = `group:${groupId}`;

      // Thông báo cho tất cả thành viên trong nhóm
      io.to(roomId).emit("newGroupMember", {
        groupId,
        memberId,
        addedBy,
      });

      // Thông báo cho thành viên mới
      if (userSockets.has(memberId)) {
        io.to(memberId).emit("addedToGroup", { groupId });

        // Tự động thêm thành viên mới vào phòng nhóm
        const memberSocketId = userSockets.get(memberId);
        const memberSocket = io.sockets.sockets.get(memberSocketId);
        if (memberSocket) {
          memberSocket.join(roomId);
        }
      }

      console.log(`Member ${memberId} added to group ${groupId} by ${addedBy}`);
    } catch (error) {
      console.error("Error handling member addition to group:", error);
    }
  });

  socket.on("memberRemovedFromGroup", async (data) => {
    const { groupId, memberId, removedBy } = data;

    try {
      const roomId = `group:${groupId}`;

      // Thông báo cho tất cả thành viên trong nhóm
      io.to(roomId).emit("memberLeftGroup", {
        groupId,
        memberId,
        removedBy,
      });

      // Thông báo cho thành viên bị xóa
      if (userSockets.has(memberId)) {
        io.to(memberId).emit("removedFromGroup", { groupId, removedBy });

        // Rời phòng nhóm
        const memberSocketId = userSockets.get(memberId);
        const memberSocket = io.sockets.sockets.get(memberSocketId);
        if (memberSocket) {
          memberSocket.leave(roomId);
        }
      }

      console.log(
        `Member ${memberId} removed from group ${groupId} by ${removedBy}`
      );
    } catch (error) {
      console.error("Error handling member removal from group:", error);
    }
  });

  socket.on("groupDissolved", async (data) => {
    const { groupId, dissolvedBy } = data;

    try {
      const roomId = `group:${groupId}`;

      // Thông báo cho tất cả thành viên trong nhóm
      io.to(roomId).emit("groupDissolved", {
        groupId,
        dissolvedBy,
      });

      console.log(`Group ${groupId} dissolved by ${dissolvedBy}`);
    } catch (error) {
      console.error("Error handling group dissolution:", error);
    }
  });

  socket.on("coAdminAdded", async (data) => {
    const { groupId, userId, addedBy } = data;

    try {
      const roomId = `group:${groupId}`;

      // Thông báo cho tất cả thành viên trong nhóm
      io.to(roomId).emit("newCoAdmin", {
        groupId,
        userId,
        addedBy,
      });

      console.log(`Co-admin ${userId} added to group ${groupId} by ${addedBy}`);
    } catch (error) {
      console.error("Error handling co-admin addition:", error);
    }
  });

  socket.on("coAdminRemoved", async (data) => {
    const { groupId, userId, removedBy } = data;

    try {
      const roomId = `group:${groupId}`;

      // Thông báo cho tất cả thành viên trong nhóm
      io.to(roomId).emit("coAdminRemoved", {
        groupId,
        userId,
        removedBy,
      });

      console.log(
        `Co-admin ${userId} removed from group ${groupId} by ${removedBy}`
      );
    } catch (error) {
      console.error("Error handling co-admin removal:", error);
    }
  });

  socket.on("sendMessage", async (data) => {
    const {
      sender,
      receiver,
      content,
      type = "text",
      tempId,
      replyToId,
      fileUrl,
      fileName,
      fileSize,
      fileThumbnail,
      fileId,
      expiryDate,
    } = data;

    try {
      // Tạo một roomId duy nhất cho cuộc trò chuyện giữa 2 người dùng
      const userIds = [sender, receiver].sort();
      const roomId = `${userIds[0]}_${userIds[1]}`;

      // Tìm tin nhắn để trả lời nếu có
      let replyToData = null;
      if (replyToId) {
        const replyMessage = await chatController.findMessageById(replyToId);
        if (replyMessage) {
          replyToData = {
            _id: replyMessage._id,
            content: replyMessage.content,
            sender: replyMessage.sender,
          };
        }
      }

      const message = await chatController.saveMessage({
        roomId,
        senderId: sender,
        receiver,
        content,
        type,
        tempId,
        replyTo: replyToData,
        fileUrl,
        fileName,
        fileSize,
        fileThumbnail,
        fileId,
        expiryDate,
      });

      // Xác định trạng thái tin nhắn dựa trên việc người nhận có online không
      const isReceiverOnline = userSockets.has(receiver);
      const initialStatus = isReceiverOnline ? "delivered" : "sent";

      // Gửi tin nhắn đến người gửi với trạng thái phù hợp
      io.to(sender).emit("receiveMessage", {
        ...message.toObject(),
        status: initialStatus,
        _tempId: tempId, // Thêm tempId để frontend có thể cập nhật tin nhắn tạm thời
      });

      // Gửi tin nhắn đến người nhận nếu họ online
      if (isReceiverOnline) {
        io.to(receiver).emit("receiveMessage", {
          ...message.toObject(),
          status: "delivered",
        });
      }

      console.log(
        `Message sent from ${sender} to ${receiver} with status ${initialStatus}`
      );
    } catch (error) {
      console.error("Error sending message:", error);
      // Thông báo lỗi cho người gửi
      io.to(sender).emit("messageError", { tempId, error: error.message });
    }
  });

  // Xử lý phản ứng với tin nhắn
  socket.on("addReaction", async (data) => {
    const { messageId, userId, emoji } = data;

    try {
      // Lưu reaction vào cơ sở dữ liệu và lấy tin nhắn đã cập nhật
      const updatedMessage = await chatController.addReactionSocket(
        messageId,
        userId,
        emoji
      );

      if (!updatedMessage) {
        console.error(`Failed to add reaction to message ${messageId}`);
        return;
      }

      // Xác định roomId từ tin nhắn
      const roomId = updatedMessage.roomId;

      console.log(
        `Gửi reaction từ ${userId} cho tin nhắn ${messageId}: ${emoji} trong phòng ${roomId}`
      );

      // Gửi reaction mới đến tất cả người dùng trong phòng
      io.to(roomId).emit("messageReaction", {
        messageId,
        userId,
        emoji,
        reactions: updatedMessage.reactions,
      });

      // Nếu là tin nhắn nhóm, cũng gửi đến phòng nhóm
      if (updatedMessage.groupId) {
        const groupRoomId = `group:${updatedMessage.groupId}`;
        io.to(groupRoomId).emit("messageReaction", {
          messageId,
          userId,
          emoji,
          reactions: updatedMessage.reactions,
        });
      }

      console.log(`Đã phát sóng reaction thành công`);
    } catch (error) {
      console.error("Error adding reaction:", error);
    }
  });

  // Sự kiện khi tin nhắn được xem
  socket.on("messageRead", (data) => {
    const { messageId, sender, receiver } = data;

    // Chỉ thông báo cho người gửi ban đầu
    if (userSockets.has(sender)) {
      io.to(sender).emit("messageStatusUpdate", {
        messageId,
        status: "seen",
      });
    }
  });

  // Handle unsend message
  socket.on("unsendMessage", async (data) => {
    try {
      const { messageId, senderId, receiverId } = data;

      if (!messageId) {
        socket.emit("error", { message: "Message ID is required" });
        return;
      }

      // Use the controller function for consistency
      const updatedMessage = await chatController.unsendMessageSocket({
        messageId,
        senderId: senderId || currentUserId,
      });

      if (!updatedMessage) {
        socket.emit("error", { message: "Failed to unsend message" });
        return;
      }

      // Notify room participants
      if (updatedMessage.chatType === "private") {
        console.log(
          `Notifying unsend message ${messageId} to room ${updatedMessage.roomId}`
        );
        io.to(updatedMessage.roomId).emit("messageUnsent", {
          messageId,
          message: updatedMessage,
        });

        // Also notify receiver directly if specified
        if (receiverId && userSockets.has(receiverId)) {
          io.to(receiverId).emit("messageUnsent", {
            messageId,
            message: updatedMessage,
          });
        }
      } else if (updatedMessage.chatType === "group") {
        const groupRoomId = `group:${updatedMessage.groupId}`;
        console.log(
          `Notifying unsend message ${messageId} to group ${groupRoomId}`
        );
        io.to(groupRoomId).emit("messageUnsent", {
          messageId,
          message: updatedMessage,
        });
      }
    } catch (error) {
      console.error("Error unsending message:", error);
      socket.emit("error", { message: "Failed to unsend message" });
    }
  });

  // Handle delete conversation
  socket.on("deleteConversation", async (data) => {
    try {
      const { roomId, forCurrentUserOnly = true } = data;

      if (!roomId) {
        socket.emit("error", { message: "Room ID is required" });
        return;
      }

      // Use the controller function
      const result = await chatController.deleteConversationSocket({
        roomId,
        userId: currentUserId,
        forCurrentUserOnly,
      });

      if (!result) {
        socket.emit("error", { message: "Failed to delete conversation" });
        return;
      }

      // Only notify the current user
      socket.emit("conversationDeleted", {
        roomId,
        success: true,
        forCurrentUserOnly,
        count: result.count,
      });

      console.log(
        `Conversation ${
          forCurrentUserOnly ? "hidden" : "deleted"
        } for user ${currentUserId}: ${roomId}`
      );
    } catch (error) {
      console.error("Error deleting conversation:", error);
      socket.emit("error", {
        message: "Failed to delete conversation",
        error: error.message,
      });
    }
  });

  // Handler for notifying clients about messages sent via API
  socket.on("notifyNewMessage", async (data) => {
    const { messageId, sender, receiver, roomId, tempId, type = "text" } = data;

    try {
      // Find the message in the database to get all details
      const message = await chatController.findMessageById(messageId);

      if (!message) {
        console.error(
          `Cannot find message with ID ${messageId} for notification`
        );
        return;
      }

      // Populate sender information
      await message.populate("sender", "name avt");

      console.log(
        `Notifying clients about message ${messageId} in room ${
          roomId || "direct"
        }`
      );

      // For direct messages, ensure we have a proper roomId
      let effectiveRoomId = roomId;
      if (!effectiveRoomId && sender && receiver) {
        // Create a consistent room ID for direct messages
        const sortedIds = [sender, receiver].sort();
        effectiveRoomId = `${sortedIds[0]}_${sortedIds[1]}`;
        console.log(
          `Created effective room ID for direct message: ${effectiveRoomId}`
        );
      }

      // Before emitting to clients, convert reactions
      if (message) {
        const messageObj = message.toObject ? message.toObject() : message;
        const processedMessage = convertReactionsMapToObject(messageObj);

        // Broadcast message to all clients in the room, except sender
        if (effectiveRoomId) {
          console.log(`Broadcasting to room ${effectiveRoomId}`);

          // Emit message to the room, excluding the sender
          socket.to(effectiveRoomId).emit("message", {
            ...processedMessage,
            _tempId: tempId,
          });

          // Also emit receiveMessage event for compatibility with mobile
          socket.to(effectiveRoomId).emit("receiveMessage", {
            ...processedMessage,
            _tempId: tempId,
          });
        }

        // Additionally, send to the recipient directly to ensure delivery
        // This is a safety measure in case they're not in the room
        if (receiver && receiver !== sender) {
          if (userSockets.has(receiver)) {
            console.log(`Sending direct notification to user ${receiver}`);

            io.to(receiver).emit("message", {
              ...processedMessage,
              _tempId: tempId,
            });

            io.to(receiver).emit("receiveMessage", {
              ...processedMessage,
              _tempId: tempId,
            });
          } else {
            console.log(
              `Receiver ${receiver} is not online, can't send direct notification`
            );
          }
        }

        console.log(`Successfully notified about message ${messageId}`);
      }
    } catch (error) {
      console.error("Error handling message notification:", error);
    }
  });

  // Handle private messages
  socket.on("privateMessage", async (data) => {
    try {
      // ... existing code ...

      // Handle file messages
      if (data.fileData) {
        const fileMessage = await chatController.saveMessageWithAttachment({
          sender: data.senderId || data.sender,
          receiver: data.receiverId || data.receiver,
          roomId: data.roomId,
          fileData: data.fileData,
          chatType: "private",
        });

        // Emit to both sender and receiver
        io.to(receiverSocketId).emit("newMessage", fileMessage);
        socket.emit("messageSent", {
          success: true,
          message: fileMessage,
          tempId: data.tempId,
        });

        // Track this message to avoid duplicates
        if (data.tempId) {
          processedMessages.set(data.tempId, {
            content: fileMessage.content,
            sender: fileMessage.sender,
            timestamp: Date.now(),
          });
        }

        return; // Exit early since we've handled the file message
      }

      // ... rest of existing function ...
    } catch (error) {
      // ... existing error handling ...
    }
  });

  // Handle group messages
  socket.on("groupMessage", async (data) => {
    try {
      // ... existing code ...

      // Handle file messages for groups
      if (data.fileData) {
        const fileMessage = await chatController.saveMessageWithAttachment({
          sender: data.senderId || data.sender,
          roomId: data.roomId,
          fileData: data.fileData,
          chatType: "group",
          groupId: data.groupId,
        });

        // Emit the file message to the entire group room
        io.to(groupRoomId).emit("newGroupMessage", fileMessage);
        socket.emit("messageSent", {
          success: true,
          message: fileMessage,
          tempId: data.tempId,
        });

        // Track this message to avoid duplicates
        if (data.tempId) {
          processedMessages.set(data.tempId, {
            content: fileMessage.content,
            sender: fileMessage.sender,
            timestamp: Date.now(),
          });
        }

        return; // Exit early since we've handled the file message
      }

      // ... rest of existing function ...
    } catch (error) {
      // ... existing error handling ...
    }
  });

  // Handle message reactions
  socket.on("messageReaction", async (data) => {
    try {
      const { messageId, emoji, action } = data;

      if (!messageId || !emoji) {
        socket.emit("error", { message: "Missing required fields" });
        return;
      }

      // Find the message
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit("error", { message: "Message not found" });
        return;
      }

      // Get room ID to notify participants
      const roomId = message.roomId;
      const senderId = currentUserId;

      // Initialize reactions Map if it doesn't exist
      if (!message.reactions) {
        message.reactions = new Map();
      }

      // Get existing reactions for this emoji or create new array
      let emojiReactions = message.reactions.get(emoji) || [];

      if (action === "add") {
        // Check if user already reacted with this emoji
        const existingReactionIndex = emojiReactions.findIndex(
          (r) => r.userId && r.userId.toString() === senderId.toString()
        );

        if (existingReactionIndex === -1) {
          // Add new reaction
          emojiReactions.push({
            emoji,
            userId: senderId,
            createdAt: new Date(),
          });
        }
      } else if (action === "remove") {
        // Remove the reaction
        emojiReactions = emojiReactions.filter(
          (r) => !r.userId || r.userId.toString() !== senderId.toString()
        );
      }

      // Update reactions for this emoji
      if (emojiReactions.length > 0) {
        message.reactions.set(emoji, emojiReactions);
      } else {
        message.reactions.delete(emoji);
      }

      await message.save();
      await message.populate("sender", "firstName lastName profileImage");

      // Before emitting to clients, convert reactions
      const messageObj = message.toObject ? message.toObject() : message;
      const processedMessage = convertReactionsMapToObject(messageObj);

      // Notify room participants about the reaction
      if (message.chatType === "private") {
        // Notify both participants
        io.to(roomId).emit("messageReactionUpdate", {
          messageId,
          reactions: processedMessage.reactions,
          senderId,
        });
      } else if (message.chatType === "group") {
        // Get group room ID
        const groupRoomId = `group:${message.groupId}`;
        // Notify all group members
        io.to(groupRoomId).emit("messageReactionUpdate", {
          messageId,
          reactions: processedMessage.reactions,
          senderId,
        });
      }
    } catch (error) {
      console.error("Error handling message reaction:", error);
      socket.emit("error", { message: "Failed to process reaction" });
    }
  });

  // Handle hide message for current user
  socket.on("hideMessage", async (data) => {
    try {
      const { messageId } = data;

      if (!messageId) {
        socket.emit("error", { message: "Message ID is required" });
        return;
      }

      // Use the controller function for consistency
      const updatedMessage = await chatController.hideMessageForMeSocket({
        messageId,
        userId: currentUserId,
      });

      if (!updatedMessage) {
        socket.emit("error", { message: "Failed to hide message" });
        return;
      }

      // Only notify the current user
      socket.emit("messageHidden", {
        messageId,
        success: true,
      });
    } catch (error) {
      console.error("Error hiding message:", error);
      socket.emit("error", {
        message: "Failed to hide message",
        error: error.message,
      });
    }
  });

  // Handle reply to message
  socket.on("replyToMessage", async (data) => {
    try {
      const { originalMessageId, content, receiverId, roomId, groupId } = data;

      if (!originalMessageId || !content || !roomId) {
        socket.emit("error", { message: "Missing required fields for reply" });
        return;
      }

      // Find the original message
      const originalMessage = await Message.findById(originalMessageId);
      if (!originalMessage) {
        socket.emit("error", { message: "Original message not found" });
        return;
      }

      // Create reply data
      const replyData = {
        _id: originalMessageId,
        content: originalMessage.content,
        sender: originalMessage.sender,
      };

      // Create new message with reply reference
      const message = new Message({
        sender: currentUserId,
        receiver: receiverId || null,
        groupId: groupId || null,
        roomId,
        content,
        chatType: groupId ? "group" : "private",
        replyTo: replyData,
      });

      await message.save();
      await message.populate("sender", "firstName lastName profileImage");

      if (groupId) {
        // Group message reply
        const groupRoomId = `group:${groupId}`;
        io.to(groupRoomId).emit("newGroupMessage", message);
      } else {
        // Private message reply
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("newMessage", message);
        }
        socket.emit("messageSent", {
          success: true,
          message,
          tempId: data.tempId,
        });
      }
    } catch (error) {
      console.error("Error replying to message:", error);
      socket.emit("error", { message: "Failed to send reply" });
    }
  });

  // Handle forward message
  socket.on("forwardMessage", async (data) => {
    try {
      const { messageId, recipients } = data;

      if (
        !messageId ||
        !recipients ||
        !Array.isArray(recipients) ||
        recipients.length === 0
      ) {
        socket.emit("error", { message: "Invalid forward request" });
        return;
      }

      // Find the original message
      const originalMessage = await Message.findById(messageId);
      if (!originalMessage) {
        socket.emit("error", { message: "Message not found" });
        return;
      }

      // Forward message to each recipient
      const results = [];
      for (const recipient of recipients) {
        // Create room ID for private chat
        const roomId = createRoomId(currentUserId, recipient.userId);

        // Create forwarded message
        const forwardedMessage = new Message({
          sender: currentUserId,
          receiver: recipient.userId,
          roomId,
          content: originalMessage.content,
          type: originalMessage.type,
          fileUrl: originalMessage.fileUrl,
          fileName: originalMessage.fileName,
          fileSize: originalMessage.fileSize,
          fileThumbnail: originalMessage.fileThumbnail,
          chatType: "private",
        });

        await forwardedMessage.save();
        await forwardedMessage.populate(
          "sender",
          "firstName lastName profileImage"
        );

        // Send to recipient if online
        const receiverSocketId = userSockets.get(recipient.userId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("newMessage", forwardedMessage);
        }

        results.push({
          recipient: recipient.userId,
          success: true,
          message: forwardedMessage,
        });
      }

      // Notify sender of successful forwards
      socket.emit("messagesForwarded", { results });
    } catch (error) {
      console.error("Error forwarding message:", error);
      socket.emit("error", { message: "Failed to forward message" });
    }
  });

  socket.on("disconnect", () => {
    // Chỉ log disconnect khi người dùng đã xác thực
    if (authenticated) {
      console.log(`User ${currentUserId} disconnected`);

      // Xóa thông tin socket và cập nhật trạng thái người dùng
      userSockets.delete(currentUserId);
      onlineUsers.delete(currentUserId);

      // Thông báo cho tất cả người dùng khác
      socket.broadcast.emit("userOffline", currentUserId);
    }
  });
});

// Khởi động server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server đang chạy trên địa chỉ http://0.0.0.0:${PORT}`);
  console.log(
    `Server cũng có thể truy cập qua http://192.168.1.7:${PORT} từ các thiết bị khác`
  );
});
