import { io, Socket } from "socket.io-client";
import { API_URL } from "../config/constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

class SocketService {
  private socket: Socket | null = null;
  private isConnecting: boolean = false;
  private connectionPromise: Promise<Socket | null> | null = null;
  private onlineUsers: Set<string> = new Set();
  private receivedMessages: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  // Get socket instance (creates one if doesn't exist)
  async initSocket(): Promise<Socket | null> {
    // If already connected, return existing socket
    if (this.socket?.connected) {
      return this.socket;
    }

    // If already connecting, return the existing promise
    if (this.isConnecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    // Create a new connection promise
    this.isConnecting = true;
    this.connectionPromise = this.createConnection();
    return this.connectionPromise;
  }

  private async createConnection(): Promise<Socket | null> {
    try {
      const token = await AsyncStorage.getItem("token");

      if (!token) {
        console.log("No token available for socket connection");
        this.isConnecting = false;
        return null;
      }

      // Close existing socket if it exists
      if (this.socket) {
        this.socket.close();
      }

      // Create new socket connection
      this.socket = io(API_URL, {
        auth: {
          token,
        },
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        timeout: 10000,
      });

      // Set up event handlers
      this.socket.on("connect", () => {
        console.log("Socket connected with ID:", this.socket?.id);
        this.reconnectAttempts = 0;
      });

      this.socket.on("disconnect", (reason) => {
        console.log("Socket disconnected:", reason);
      });

      this.socket.on("connect_error", (error) => {
        console.error("Socket connection error:", error);
        this.reconnectAttempts++;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.log("Max reconnection attempts reached, giving up");
          this.socket?.close();
        }
      });

      this.socket.on("onlineUsers", (users: string[]) => {
        this.onlineUsers = new Set(users);
      });

      // Wait for connection to establish
      await new Promise<void>((resolve, reject) => {
        if (!this.socket) return reject("Socket initialization failed");

        // Set timeout for connection
        const timeout = setTimeout(() => {
          reject("Socket connection timeout");
        }, 5000);

        this.socket.on("connect", () => {
          clearTimeout(timeout);
          resolve();
        });

        this.socket.on("connect_error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this.isConnecting = false;
      return this.socket;
    } catch (error) {
      console.error("Socket connection failed:", error);
      this.isConnecting = false;
      return null;
    }
  }

  // Join a chat room
  joinChatRoom(roomId: string | any, isGroup: boolean = false): void {
    // Validate roomId and handle edge cases
    if (!roomId) {
      console.error("Cannot join room: Invalid roomId");
      return;
    }

    // Handle case where an object is passed instead of string
    let formattedRoomId: string;

    if (typeof roomId === "object") {
      // If we got an object, try to extract ID or convert to string in a safe way
      if (roomId._id) {
        formattedRoomId = roomId._id.toString();
      } else if (roomId.id) {
        formattedRoomId = roomId.id.toString();
      } else {
        console.error(
          "Cannot join room: roomId is an object without _id property",
          roomId
        );
        formattedRoomId = JSON.stringify(roomId);
      }
    } else {
      formattedRoomId = roomId.toString();
    }

    // For group chats, prefix with 'group:' to match server expectations
    if (isGroup && !formattedRoomId.startsWith("group:")) {
      formattedRoomId = `group:${formattedRoomId}`;
    }

    if (this.socket?.connected) {
      this.socket.emit("joinRoom", { roomId: formattedRoomId });
      console.log(
        `Joined room${isGroup ? " (group)" : ""}: ${formattedRoomId}`
      );
    } else {
      console.error("Cannot join room: socket not connected");
      // Try to reconnect and then join
      this.initSocket().then((socket) => {
        if (socket) {
          socket.emit("joinRoom", { roomId: formattedRoomId });
          console.log(
            `Joined room${
              isGroup ? " (group)" : ""
            } after reconnection: ${formattedRoomId}`
          );
        }
      });
    }
  }

  // Send a message
  sendMessage(messageData: any): boolean {
    if (!this.socket?.connected) {
      console.error("Cannot send message: socket not connected");
      return false;
    }

    // Create a copy to avoid modifying the original
    const enhancedMessage = { ...messageData };

    // Ensure sender is set
    if (!enhancedMessage.sender) {
      try {
        AsyncStorage.getItem("user").then((userData) => {
          if (userData) {
            const user = JSON.parse(userData);
            enhancedMessage.sender = user._id;
          }
        });
      } catch (error) {
        console.error("Error adding sender to message:", error);
      }
    }

    // Add necessary fields for direct messages
    enhancedMessage.chatType = "private";

    // Format roomId for direct messages
    if (enhancedMessage.roomId && typeof enhancedMessage.roomId === "string") {
      if (enhancedMessage.sender && enhancedMessage.receiver) {
        const userIds = [
          typeof enhancedMessage.sender === "object"
            ? enhancedMessage.sender._id
            : enhancedMessage.sender,
          typeof enhancedMessage.receiver === "object"
            ? enhancedMessage.receiver._id
            : enhancedMessage.receiver,
        ].sort();
        enhancedMessage.roomId = `${userIds[0]}_${userIds[1]}`;
      }
    }

    console.log(
      "Sending direct message with data:",
      JSON.stringify(enhancedMessage)
    );
    this.socket.emit("sendMessage", enhancedMessage);
    console.log(
      "Direct message sent via socket:",
      enhancedMessage.tempId || enhancedMessage._id
    );
    return true;
  }

  // Send a group message
  async sendGroupMessage(messageData: any): Promise<boolean> {
    // Create a copy to avoid modifying the original
    const enhancedMessage = {
      ...messageData,
      chatType: "group",
    };

    // Ensure sender and senderId are set
    if (!enhancedMessage.sender || !enhancedMessage.senderId) {
      try {
        const userData = await AsyncStorage.getItem("user");
        if (userData) {
          const user = JSON.parse(userData);
          enhancedMessage.sender = user._id;
          enhancedMessage.senderId = user._id;
        }
      } catch (error) {
        console.error("Error adding sender to message:", error);
      }
    }

    // Format roomId for group messages - use groupId if available
    if (enhancedMessage.groupId) {
      enhancedMessage.roomId = enhancedMessage.groupId;
    }

    // Send via API for reliability and database persistence
    try {
      const token = await AsyncStorage.getItem("token");
      if (token) {
        console.log("Sending group message via API for reliability");

        const apiMessageData = { ...enhancedMessage };

        const response = await axios.post(
          `${API_URL}/api/groups/message`,
          apiMessageData,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        console.log("API response for group message:", response.data);

        // After successful API send, also emit to socket for real-time delivery
        if (response.data && this.socket?.connected) {
          // Mark as already handled by API to prevent duplicate display
          const socketData = {
            ...response.data,
            _alreadyHandledByApi: true,
          };

          // Add proper room format for socket
          if (socketData.groupId && !socketData.groupId.startsWith("group:")) {
            socketData.roomId = `group:${socketData.groupId}`;
          }

          console.log("Also notifying via socket for real-time delivery");
          this.socket.emit("groupMessage", socketData);

          // Mark received to prevent duplicates
          this.markMessageReceived(response.data._id, enhancedMessage.tempId);
        }

        return true;
      }
    } catch (error) {
      console.error("API send failed:", error);

      // Only try socket as fallback if API fails
      if (this.socket?.connected) {
        try {
          console.log("Attempting to send via socket as fallback");

          // Format socket message properly
          if (
            enhancedMessage.groupId &&
            !enhancedMessage.roomId.startsWith("group:")
          ) {
            enhancedMessage.roomId = `group:${enhancedMessage.groupId}`;
          }

          this.socket.emit("groupMessage", enhancedMessage);
          console.log("Group message sent via socket fallback");
          return true;
        } catch (socketError) {
          console.error("Socket fallback failed:", socketError);
          return false;
        }
      }
    }

    return false;
  }

  // Track received messages to prevent duplicates
  markMessageReceived(messageId: string, tempId?: string): void {
    if (messageId) {
      this.receivedMessages.add(messageId);
    }

    if (tempId) {
      this.receivedMessages.add(tempId);
    }

    // Chỉ giữ 1000 tin nhắn gần nhất để tránh memory leak
    if (this.receivedMessages.size > 1000) {
      const entries = Array.from(this.receivedMessages);
      const toRemove = entries.slice(0, entries.length - 1000);
      toRemove.forEach((id) => this.receivedMessages.delete(id));
    }
  }

  isMessageReceived(messageId: string, tempId?: string): boolean {
    if (messageId && this.receivedMessages.has(messageId)) {
      return true;
    }

    if (tempId && this.receivedMessages.has(tempId)) {
      return true;
    }

    return false;
  }

  // User typing status
  sendTypingStatus(data: { sender: string; receiver: string }): void {
    if (this.socket?.connected) {
      this.socket.emit("typing", data);
    }
  }

  sendStopTypingStatus(data: { sender: string; receiver: string }): void {
    if (this.socket?.connected) {
      this.socket.emit("stopTyping", data);
    }
  }

  // Mark message as read
  markMessageAsRead(data: {
    messageId: string;
    sender: string | null | object;
    receiver: string | null | object;
  }): void {
    if (this.socket?.connected) {
      // Ensure sender and receiver are valid strings
      const updatedData = {
        messageId: data.messageId,
        sender:
          typeof data.sender === "object"
            ? (data.sender as any)?._id || ""
            : data.sender || "",
        receiver:
          typeof data.receiver === "object"
            ? (data.receiver as any)?._id || ""
            : data.receiver || "",
      };

      this.socket.emit("messageRead", updatedData);
    }
  }

  // Reactions
  addReaction(data: {
    messageId: string;
    userId: string;
    emoji: string;
  }): void {
    if (this.socket?.connected) {
      this.socket.emit("addReaction", data);
    }
  }

  // Unsend message
  unsendMessage(data: {
    messageId: string;
    senderId: string;
    receiverId: string;
  }): void {
    if (this.socket?.connected) {
      this.socket.emit("unsendMessage", data);
    }
  }

  // Check if user is online
  isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  // Clean up on app close/logout
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnecting = false;
    this.connectionPromise = null;
  }

  // Request missed messages for a specific room
  requestMissedMessages(roomId: string | any, isGroup: boolean = false): void {
    // Validate roomId and handle edge cases
    if (!roomId) {
      console.error("Cannot request missed messages: Invalid roomId");
      return;
    }

    // Handle case where an object is passed instead of string
    let formattedRoomId: string;

    if (typeof roomId === "object") {
      // If we got an object, try to extract ID or convert to string in a safe way
      if (roomId._id) {
        formattedRoomId = roomId._id.toString();
      } else if (roomId.id) {
        formattedRoomId = roomId.id.toString();
      } else {
        console.error(
          "Cannot request missed messages: roomId is an object without _id property",
          roomId
        );
        formattedRoomId = JSON.stringify(roomId);
      }
    } else {
      formattedRoomId = roomId.toString();
    }

    // For group chats, prefix with 'group:' to match server expectations
    if (isGroup && !formattedRoomId.startsWith("group:")) {
      formattedRoomId = `group:${formattedRoomId}`;
    }

    if (this.socket?.connected) {
      console.log(
        `Requesting missed messages for room${
          isGroup ? " (group)" : ""
        }: ${formattedRoomId}`
      );
      this.socket.emit("getMissedMessages", { roomId: formattedRoomId });
    } else {
      console.log("Cannot request missed messages: socket not connected");
      // Try to reconnect and then request
      this.initSocket().then((socket) => {
        if (socket) {
          console.log(
            `Requesting missed messages after reconnection${
              isGroup ? " (group)" : ""
            }: ${formattedRoomId}`
          );
          socket.emit("getMissedMessages", { roomId: formattedRoomId });
        }
      });
    }
  }

  // Listen for connection state changes
  setupConnectionStateListeners(
    onConnect?: () => void,
    onDisconnect?: (reason: string) => void
  ): () => void {
    if (!this.socket) {
      console.error("No socket instance available");
      return () => {};
    }

    const connectHandler = () => {
      console.log("Socket connected in listener");
      if (onConnect) onConnect();
    };

    const disconnectHandler = (reason: string) => {
      console.log(`Socket disconnected in listener: ${reason}`);
      if (onDisconnect) onDisconnect(reason);
    };

    this.socket.on("connect", connectHandler);
    this.socket.on("disconnect", disconnectHandler);

    // Return cleanup function
    return () => {
      if (this.socket) {
        this.socket.off("connect", connectHandler);
        this.socket.off("disconnect", disconnectHandler);
      }
    };
  }
}

// Create a singleton instance
const socketService = new SocketService();
export default socketService;
