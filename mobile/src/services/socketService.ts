import { io, Socket } from "socket.io-client";
import { API_URL } from "../config/constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { getAuthToken } from "../utils/auth";

class SocketService {
  private socket: Socket | null = null;
  private isConnecting: boolean = false;
  private connectionPromise: Promise<Socket | null> | null = null;
  private onlineUsers: Set<string> = new Set();
  private receivedMessages: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private groupRooms: Set<string> = new Set();
  private directRooms: Set<string> = new Set();

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
      // Get token asynchronously 
      const token = await getAuthToken();

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
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        autoConnect: true,
        transports: ['websocket', 'polling'],
        forceNew: false,
        path: '/socket.io',
      });

      // Set up event handlers
      this.socket.on("connect", () => {
        console.log("Socket connected with ID:", this.socket?.id);
        this.reconnectAttempts = 0;
        this.rejoinRooms();
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

  // Rejoin all rooms after reconnection
  private rejoinRooms() {
    if (!this.socket) return;
    
    // Rejoin group rooms
    this.groupRooms.forEach(groupId => {
      console.log('Rejoining group room after reconnection:', groupId);
      this.joinGroupRoom(groupId);
    });
    
    // Rejoin direct chat rooms
    this.directRooms.forEach(roomData => {
      const [sender, receiver] = roomData.split('_');
      console.log('Rejoining direct room after reconnection:', sender, receiver);
      this.joinDirectRoom(sender, receiver);
    });
  }

  // Join a group room
  async joinGroupRoom(groupId: string): Promise<boolean> {
    if (!this.socket) {
      console.log('Socket not connected, unable to join group room');
      return false;
    }

    // Store room for reconnection
    this.groupRooms.add(groupId);
    
    // Join with multiple formats for compatibility with web client
    const roomId = `group:${groupId}`;
    
    // Format 1: Join with direct roomId
    this.socket.emit('joinRoom', { roomId });
    
    // Format 2: Join with explicit group room
    this.socket.emit('joinGroupRoom', { groupId });
    
    console.log('Joined group chat room:', groupId, 'success:', this.socket.connected);
    console.log('Explicitly joined group room:', groupId);
    
    // Request any missed messages
    this.socket.emit('requestMissedMessages', {
      roomId,
      isGroup: true
    });
    console.log('Requested missed messages for group:', groupId);
    
    return true;
  }

  // Join a direct chat room
  async joinDirectRoom(sender: string, receiver: string): Promise<boolean> {
    if (!this.socket) {
      console.log('Socket not connected, unable to join direct room');
      return false;
    }

    // Create a consistent room ID format
    const roomId = [sender, receiver].sort().join('_');
    
    // Store room for reconnection
    this.directRooms.add(roomId);
    
    // Join with roomId format
    this.socket.emit('joinRoom', { roomId });
    console.log('Joined room:', roomId);
    
    // Also join with explicit sender/receiver format
    this.socket.emit('joinDirectRoom', { sender, receiver });
    console.log('Explicitly joining direct room with:', { sender, receiver });
    
    // Request any missed messages
    this.socket.emit('requestMissedMessages', { roomId });
    console.log('Requesting missed messages for room:', roomId);
    
    return true;
  }

  // Send a message
  async sendMessage(messageData: any): Promise<boolean> {
    if (!this.socket || !this.socket.connected) {
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
    if (!this.socket || !this.socket.connected) {
      console.error("Socket not connected, unable to emit group message via socket");
      return false;
    }

    // Create a copy to avoid modifying the original
    const enhancedMessage = {
      ...messageData,
      timestamp: messageData.timestamp || new Date().toISOString(),
      roomId: messageData.roomId || `group:${messageData.groupId}`,
    };

    // Emit with both formats for compatibility
    this.socket.emit('sendGroupMessage', enhancedMessage);
    
    // Also emit generic message format that web can handle
    this.socket.emit('message', {
      ...enhancedMessage,
      room: `group:${messageData.groupId}`
    });
    
    console.log('Socket send result: success');
    return true;
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
  async sendTypingStatus(data: { 
    sender: string; 
    receiver?: string;
    groupId?: string;
    senderName?: string;
  }): Promise<boolean> {
    if (!this.socket || !this.socket.connected) return false;
    
    if (data.groupId) {
      this.socket.emit('typingInGroup', {
        senderId: data.sender,
        groupId: data.groupId,
        senderName: data.senderName || "User"
      });
    } else if (data.receiver) {
      this.socket.emit('typing', {
        sender: data.sender,
        receiver: data.receiver
      });
    }
    
    return true;
  }

  async sendStopTypingStatus(data: { 
    sender: string; 
    receiver?: string;
    groupId?: string;
  }): Promise<boolean> {
    if (!this.socket || !this.socket.connected) return false;
    
    if (data.groupId) {
      this.socket.emit('stopTypingInGroup', {
        senderId: data.sender,
        groupId: data.groupId
      });
    } else if (data.receiver) {
      this.socket.emit('stopTyping', {
        sender: data.sender,
        receiver: data.receiver
      });
    }
    
    return true;
  }

  // Mark message as read
  async markMessageAsRead(data: {
    messageId: string;
    sender: string | null | object;
    receiver: string | null | object;
  }): Promise<boolean> {
    if (!this.socket || !this.socket.connected) return false;
    
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
    return true;
  }

  // Reactions
  async addReaction(data: {
    messageId: string;
    userId: string;
    emoji: string;
  }): Promise<boolean> {
    if (!this.socket || !this.socket.connected) return false;
    
    this.socket.emit("addReaction", data);
    return true;
  }

  // Unsend message
  async unsendMessage(data: {
    messageId: string;
    senderId: string;
    receiverId: string;
  }): Promise<boolean> {
    if (!this.socket || !this.socket.connected) return false;
    
    this.socket.emit("unsendMessage", data);
    return true;
  }

  // Check if user is online
  async isUserOnline(userId: string): Promise<boolean> {
    return this.onlineUsers.has(userId);
  }

  // Clean up on app close/logout
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.groupRooms.clear();
      this.directRooms.clear();
    }
    this.isConnecting = false;
    this.connectionPromise = null;
  }

  // Request missed messages for a specific room
  async requestMissedMessages(roomId: string | any, isGroup: boolean = false): Promise<void> {
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

  // Backward compatibility method for legacy code
  async joinChatRoom(roomId: string | any, isGroup: boolean = false): Promise<boolean> {
    console.log(`[SOCKET COMPATIBILITY] joinChatRoom called with roomId=${roomId}, isGroup=${isGroup}`);
    
    try {
      // Validate roomId and handle edge cases
      if (!roomId) {
        console.error("Cannot join room: Invalid roomId");
        return false;
      }

      // Handle case where an object is passed instead of string
      let formattedRoomId: string;

      if (typeof roomId === "object") {
        // If we got an object, try to extract ID or convert to string
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

      // Call the appropriate new method based on room type
      if (isGroup) {
        // Extract groupId (remove 'group:' prefix if present)
        const groupId = formattedRoomId.startsWith('group:') 
          ? formattedRoomId.substring(6) 
          : formattedRoomId;
        
        return await this.joinGroupRoom(groupId);
      } else {
        // For direct chat, we need sender and receiver IDs
        // Since we don't have those directly, try to extract from roomId
        const parts = formattedRoomId.split('_');
        
        // If roomId is in the format "user1_user2"
        if (parts.length === 2) {
          // Try to get current user ID
          const userData = await AsyncStorage.getItem('user');
          if (!userData) {
            console.error("Cannot join direct room: No user data available");
            return false;
          }
          
          const user = JSON.parse(userData);
          const userId = user._id;
          
          // The other ID is the one that's not the current user
          const otherId = parts[0] === userId ? parts[1] : parts[0];
          
          return await this.joinDirectRoom(userId, otherId);
        } else {
          // If not in expected format, just join as a basic room
          this.socket?.emit('joinRoom', { roomId: formattedRoomId });
          console.log(`Joined basic room: ${formattedRoomId}`);
          return true;
        }
      }
    } catch (error) {
      console.error("Error in joinChatRoom compatibility method:", error);
      return false;
    }
  }
}

// Create a singleton instance
const socketService = new SocketService();
export default socketService;
