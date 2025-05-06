import React, { useState, useEffect, useContext, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  AlertButton,
  Linking,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { AuthContext } from "../../context/AuthContext";
import { API_URL } from "../../config/constants";
import moment from "moment";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import socketService from "../../services/socketService";
import { Socket } from "socket.io-client";
import groupChatService from "../../services/groupChatService";
import AudioPlayer from "../../components/AudioPlayer";
import Video from "react-native-video";
import * as cloudinaryService from "../../services/cloudinaryService";

interface Message {
  _id: string;
  sender: {
    _id: string;
    name: string;
    avt: string;
  };
  content: string;
  type: "text" | "image" | "video" | "audio" | "file";
  createdAt: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  reactions?: Record<string, string>;
  replyTo?: {
    _id: string;
    content: string;
    sender: {
      _id: string;
      name: string;
      avt: string;
    };
  };
  unsent: boolean;
  roomId?: string;
  receiver?:
    | string
    | {
        _id: string;
        name?: string;
        avt?: string;
      };
  groupId?: string;
  sending?: boolean;
  failed?: boolean;
  tempId?: string;
  deletedFor?: string[];
}

interface RouteParams {
  chatId: string;
  chatName: string;
  contactId: string;
  contactAvatar: string;
  isGroup?: boolean;
}

const ChatDetailScreen = () => {
  const route = useRoute();
  const {
    chatId,
    chatName,
    contactId,
    contactAvatar,
    isGroup = false,
  } = route.params as RouteParams;
  const navigation = useNavigation<any>();
  const { user } = useContext(AuthContext);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(
    null
  );
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [showReactionMenu, setShowReactionMenu] = useState(false);
  const [selectedMessageForReaction, setSelectedMessageForReaction] = useState<
    string | null
  >(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<Message | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const roomIdRef = useRef<string>("");

  // Initialize socket connection and room
  useEffect(() => {
    if (!user?._id || !contactId) {
      console.log("Missing user or contact ID");
      return;
    }

    // Create room ID - for groups use groupId, for individual chats use sorted user IDs
    let roomId;
    if (isGroup) {
      roomId = contactId; // For groups, contactId is the groupId
    } else {
      // For individual chats, create sorted room ID
      const userIds = [user._id, contactId].sort();
      roomId = `${userIds[0]}_${userIds[1]}`;
    }

    roomIdRef.current = roomId;
    console.log(
      `[SOCKET DEBUG] Setting up ${
        isGroup ? "group" : "direct"
      } chat room: ${roomId}`
    );

    // Handle socket setup in an async function with proper cleanup
    let cleanupListeners: (() => void) | null = null;
    let connectionStateCleanup: (() => void) | null = null;

    const setupSocketConnection = async () => {
      try {
        console.log(
          "[SOCKET DEBUG] Setting up socket connection for chat detail"
        );

        // Get socket instance from service
        socketRef.current = await socketService.initSocket();

        if (!socketRef.current) {
          console.error("[SOCKET DEBUG] Failed to get socket instance");
          Alert.alert(
            "Connection Error",
            "Failed to establish connection. Messages may be delayed.",
            [{ text: "Retry", onPress: setupSocketConnection }]
          );
          return;
        }

        console.log(`[SOCKET DEBUG] Socket connected, joining room: ${roomId}`);

        // For direct chat, handle both ways of joining
        if (!isGroup) {
          // Join direct chat room with standard format
          socketService.joinChatRoom(roomId, false);

          // Also directly join with explicit sender/receiver for better compatibility
          const directRoomData = {
            sender: user._id,
            receiver: contactId,
          };
          console.log(
            `[SOCKET DEBUG] Explicitly joining direct room with: ${JSON.stringify(
              directRoomData
            )}`
          );
          if (socketRef.current) {
            socketRef.current.emit("joinDirectRoom", directRoomData);
          }
        } else {
          // For group chat, join with proper group: prefix
          socketService.joinChatRoom(roomId, true);
        }

        socketService.requestMissedMessages(roomId, isGroup);

        // Setup connection state listeners
        if (connectionStateCleanup) {
          connectionStateCleanup();
        }

        connectionStateCleanup = socketService.setupConnectionStateListeners(
          // On connect
          () => {
            console.log(
              "[SOCKET DEBUG] Socket reconnected, rejoining room and requesting missed messages"
            );

            // For direct chat, also join user's own direct room (used by some servers)
            if (!isGroup) {
              // Join direct chat room
              socketService.joinChatRoom(roomId, false);

              // Join personal room (some servers use this format)
              socketService.joinChatRoom(user._id, false);

              // Also join direct room with explicit sender/receiver
              const directRoomData = {
                sender: user._id,
                receiver: contactId,
              };
              console.log(
                `[SOCKET DEBUG] Rejoining direct room with: ${JSON.stringify(
                  directRoomData
                )}`
              );
              if (socketRef.current) {
                socketRef.current.emit("joinDirectRoom", directRoomData);
              }
            } else {
              // For group chat, use the standard join method
              socketService.joinChatRoom(roomId, true);
            }

            socketService.requestMissedMessages(roomId, isGroup);
          },
          // On disconnect
          (reason) => {
            console.log(`[SOCKET DEBUG] Socket disconnected: ${reason}`);
          }
        );

        // Setup message handler for direct and group messages
        const handleNewMessage = (newMessage: any) => {
          console.log(
            `[SOCKET DEBUG] Received message: ${JSON.stringify(newMessage)}`
          );

          // Bỏ qua tin nhắn đã được xử lý qua API
          if (newMessage._alreadyProcessed || newMessage._sentViaApi) {
            console.log(
              "[SOCKET DEBUG] Skipping message already processed via API"
            );
            return;
          }

          // Thêm một kiểm tra mạnh hơn cho tin nhắn trùng lặp
          const messageId = newMessage._id;
          const tempId = newMessage._tempId || newMessage.tempId;
          const messageContent = newMessage.content;
          const messageTime = new Date(newMessage.createdAt).getTime();

          // Kiểm tra nếu tin nhắn đã tồn tại trong danh sách dựa trên ID và nội dung
          setMessages((currentMessages) => {
            // Tạo một bản sao để kiểm tra và tránh cập nhật state khi không cần thiết
            const existingMessages = [...currentMessages];

            // Kiểm tra xem tin nhắn đã tồn tại chưa
            const isDuplicate = existingMessages.some((msg) => {
              // Kiểm tra theo ID
              if (msg._id === messageId) return true;

              // Kiểm tra theo tempId nếu có
              if (tempId && msg.tempId === tempId) return true;

              // Kiểm tra trùng lặp theo nội dung và thời gian gần (trong vòng 2 giây)
              if (
                msg.content === messageContent &&
                msg.sender._id === newMessage.sender._id &&
                Math.abs(new Date(msg.createdAt).getTime() - messageTime) < 2000
              ) {
                return true;
              }

              return false;
            });

            if (isDuplicate) {
              console.log(
                `[SOCKET DEBUG] Ignoring duplicate message: ${messageId}/${tempId}`
              );
              return currentMessages; // Trả về state hiện tại không thay đổi
            }

            // Log message details
            console.log(
              `[SOCKET DEBUG] Processing message: ID=${messageId}, TempID=${tempId}, Sender=${newMessage.sender._id}`
            );

            // Check if this message has already been processed
            // First check socketService's tracked messages
            if (socketService.isMessageReceived(messageId, tempId)) {
              console.log(
                `[SOCKET DEBUG] Ignoring duplicate message tracked by socketService: ${messageId}/${tempId}`
              );
              return currentMessages;
            }

            // Mark message as received
            socketService.markMessageReceived(messageId, tempId);

            // Normalize the message format for UI
            const normalizedMessage: Message = {
              _id: messageId || `temp-${Date.now()}`,
              content: newMessage.content || "",
              type: newMessage.type || "text",
              sender: {
                _id:
                  typeof newMessage.sender === "object"
                    ? newMessage.sender._id
                    : newMessage.sender,
                name:
                  typeof newMessage.sender === "object"
                    ? newMessage.sender.name ||
                      `${newMessage.sender.firstName || ""} ${
                        newMessage.sender.lastName || ""
                      }`.trim()
                    : newMessage.sender._id === user._id
                    ? user?.name || "You"
                    : chatName,
                avt:
                  typeof newMessage.sender === "object"
                    ? newMessage.sender.avt || newMessage.sender.avatar || ""
                    : newMessage.sender._id === user._id
                    ? user?.avt || ""
                    : contactAvatar,
              },
              createdAt: newMessage.createdAt || new Date().toISOString(),
              reactions: newMessage.reactions || {},
              unsent: newMessage.unsent || false,
              fileUrl: newMessage.fileUrl || newMessage.file?.url || "",
              fileName: newMessage.fileName || newMessage.file?.name || "",
              roomId: newMessage.roomId || roomId,
              tempId: tempId, // Lưu tempId vào tin nhắn để kiểm tra sau này
            };

            // Add group-specific properties if it's a group message
            if (isGroup || newMessage.chatType === "group") {
              normalizedMessage.groupId = contactId;
            }

            // Cập nhật state với tin nhắn mới
            return [normalizedMessage, ...existingMessages];
          });

          // Mark as read if message is from the other person
          if (newMessage.sender._id !== user._id) {
            console.log(`[SOCKET DEBUG] Marking message as read: ${messageId}`);
            socketService.markMessageAsRead({
              messageId: messageId,
              sender: newMessage.sender._id,
              receiver: user._id,
            });
          }
        };

        // Remove any existing event listeners first to prevent duplicates
        if (socketRef.current) {
          socketRef.current.off("receiveMessage");
          socketRef.current.off("groupMessage");
        }

        // Add message handler for direct messages
        socketRef.current.on("receiveMessage", handleNewMessage);

        // Add specific handler for group messages
        socketRef.current.on("groupMessage", handleNewMessage);

        // Setup other event handlers
        socketRef.current.on(
          "messageStatusUpdate",
          (data: { messageId: string; status: string }) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg._id === data.messageId
                  ? { ...msg, status: data.status }
                  : msg
              )
            );
          }
        );

        socketRef.current.on(
          "messageReaction",
          (data: { messageId: string; userId: string; emoji: string }) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg._id === data.messageId
                  ? {
                      ...msg,
                      reactions: {
                        ...(msg.reactions || {}),
                        [data.userId]: data.emoji,
                      },
                    }
                  : msg
              )
            );
          }
        );

        socketRef.current.on("userTyping", (data: { userId: string }) => {
          if (!isGroup && data.userId === contactId) {
            setIsTyping(true);
          }
        });

        socketRef.current.on(
          "userStoppedTyping",
          (data: { userId: string }) => {
            if (!isGroup && data.userId === contactId) {
              setIsTyping(false);
            }
          }
        );

        socketRef.current.on("messageUnsent", (data: { messageId: string }) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg._id === data.messageId
                ? {
                    ...msg,
                    content: "This message has been unsent",
                    unsent: true,
                  }
                : msg
            )
          );
        });

        // Store cleanup function
        cleanupListeners = () => {
          if (socketRef.current) {
            socketRef.current.off("receiveMessage");
            socketRef.current.off("groupMessage");
            socketRef.current.off("messageStatusUpdate");
            socketRef.current.off("messageReaction");
            socketRef.current.off("userTyping");
            socketRef.current.off("userStoppedTyping");
            socketRef.current.off("messageUnsent");
          }
        };
      } catch (error) {
        console.error("[SOCKET DEBUG] Socket setup error:", error);
        Alert.alert(
          "Connection Error",
          "Failed to establish connection. Messages may be delayed.",
          [{ text: "Retry", onPress: setupSocketConnection }]
        );
      }
    };

    // Call the setup function
    setupSocketConnection();

    // Return cleanup function that uses the stored reference
    return () => {
      if (cleanupListeners) {
        cleanupListeners();
      }
      if (connectionStateCleanup) {
        connectionStateCleanup();
      }
    };
  }, [user?._id, contactId, chatName, contactAvatar, isGroup]);

  // Load group info if it's a group chat
  useEffect(() => {
    if (isGroup && contactId) {
      const loadGroupInfo = async () => {
        try {
          const token = await AsyncStorage.getItem("token");

          if (!token) {
            console.error("No auth token available for loading group info");
            return;
          }

          const response = await axios.get(
            `${API_URL}/api/groups/${contactId}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (response.data) {
            setGroupInfo(response.data);
            setGroupMembers(response.data.members || []);
          }
        } catch (error) {
          console.error("Failed to load group info:", error);
        }
      };

      loadGroupInfo();
    }
  }, [isGroup, contactId]);

  // Load initial messages with optimized approach
  useEffect(() => {
    const loadMessages = async () => {
      try {
        setLoading(true);

        // Get token from storage
        const token = await AsyncStorage.getItem("token");

        if (!token) {
          console.error("No auth token available for loading messages");
          Alert.alert("Error", "Authentication required. Please log in again.");
          return;
        }

        let messagesData = [];
        let response;

        // For group chats, use group messages endpoint
        if (isGroup) {
          try {
            console.log(`Fetching group messages for group ${contactId}`);
            response = await axios.get(
              `${API_URL}/api/groups/${contactId}/messages`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );

            if (response.data) {
              if (Array.isArray(response.data)) {
                messagesData = response.data;
                console.log(
                  `Loaded ${messagesData.length} group messages directly from response array`
                );
              } else if (
                response.data.messages &&
                Array.isArray(response.data.messages)
              ) {
                messagesData = response.data.messages;
                console.log(
                  `Loaded ${messagesData.length} group messages from response.data.messages`
                );
              } else {
                console.log(
                  "Unexpected response format for group messages:",
                  response.data
                );
                messagesData = [];
              }
            } else {
              console.log("No data returned for group messages");
              messagesData = [];
            }
          } catch (err) {
            console.log("Group messages endpoint failed:", err.message || err);
            console.log(`Trying alternate endpoint for group ${contactId}...`);

            // Try alternate endpoint as fallback
            try {
              response = await axios.get(
                `${API_URL}/api/chat/groups/${contactId}/messages`,
                {
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                }
              );

              if (response.data) {
                messagesData = Array.isArray(response.data)
                  ? response.data
                  : response.data.messages
                  ? response.data.messages
                  : [];

                console.log(
                  `Loaded ${messagesData.length} group messages from alternate endpoint`
                );
              }
            } catch (altErr) {
              console.log(
                "Alternate group messages endpoint also failed:",
                altErr.message || altErr
              );
            }
          }
        } else {
          // For individual chats, use existing logic
          // Create a consistent room ID based on sorted user IDs
          const sortedUserIds = [user?._id, contactId].sort();
          const roomId = `${sortedUserIds[0]}_${sortedUserIds[1]}`;

          // Try to get messages using direct endpoint first (fastest)
          try {
            // Use endpoint with a timeout to prevent long waits
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Loading messages timed out")),
                3000
              )
            );

            const fetchPromise = axios.get(
              `${API_URL}/api/chat/messages/${sortedUserIds[0]}/${sortedUserIds[1]}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );

            response = await Promise.race([fetchPromise, timeoutPromise]);

            if (response.data) {
              // Handle array or nested format
              messagesData = Array.isArray(response.data)
                ? response.data
                : response.data.messages
                ? response.data.messages
                : [];

              console.log(
                `Loaded ${messagesData.length} messages from direct endpoint`
              );
            }
          } catch (err) {
            console.log("Direct messages endpoint failed:", err.message);

            // If direct endpoint failed, try room-based endpoint as backup
            try {
              response = await axios.get(
                `${API_URL}/api/chat/room/${roomId}/messages`,
                {
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                }
              );

              if (response.data) {
                messagesData = Array.isArray(response.data)
                  ? response.data
                  : response.data.messages
                  ? response.data.messages
                  : [];

                console.log(
                  `Loaded ${messagesData.length} messages from room endpoint`
                );
              }
            } catch (roomErr) {
              console.log("Room messages endpoint failed:", roomErr.message);

              // Last attempt - try with chat ID if provided
              if (chatId) {
                try {
                  response = await axios.get(
                    `${API_URL}/api/chat/${chatId}/messages`,
                    {
                      headers: {
                        Authorization: `Bearer ${token}`,
                      },
                    }
                  );

                  if (response.data) {
                    messagesData = Array.isArray(response.data)
                      ? response.data
                      : response.data.messages
                      ? response.data.messages
                      : [];

                    console.log(
                      `Loaded ${messagesData.length} messages from chat ID endpoint`
                    );
                  }
                } catch (chatErr) {
                  console.log(
                    "Chat ID messages endpoint failed:",
                    chatErr.message
                  );
                }
              }
            }
          }
        }

        // Transform messages to consistent format
        const formattedMessages = messagesData.map((msg: any) => {
          // Normalize sender format
          let sender = msg.sender || {};
          if (typeof sender === "string") {
            sender = {
              _id: sender,
              name: sender === user?._id ? user?.name || "You" : chatName,
              avt: sender === user?._id ? user?.avt || "" : contactAvatar,
            };
          } else if (!sender._id && msg.senderId) {
            sender = {
              _id: msg.senderId,
              name: msg.senderId === user?._id ? user?.name || "You" : chatName,
              avt: msg.senderId === user?._id ? user?.avt || "" : contactAvatar,
            };
          }

          // Create a consistent room ID based on sorted user IDs
          const messageRoomId =
            msg.roomId ||
            (isGroup
              ? contactId
              : `${[user?._id, contactId].sort().join("_")}`);

          return {
            _id: msg._id || msg.id || `temp-${Date.now()}-${Math.random()}`,
            content: msg.content || "",
            type: msg.type || "text",
            sender: {
              _id: sender._id || sender.id || "",
              name:
                sender.name ||
                `${sender.firstName || ""} ${sender.lastName || ""}`.trim() ||
                "Unknown",
              avt: sender.avt || sender.avatar || "",
            },
            createdAt: msg.createdAt || new Date().toISOString(),
            reactions: msg.reactions || {},
            unsent: msg.unsent || false,
            fileUrl: msg.fileUrl || msg.file?.url || "",
            fileName: msg.fileName || msg.file?.name || "",
            roomId: messageRoomId,
          };
        });

        // Sort newest first for FlatList
        setMessages(formattedMessages.reverse());
      } catch (error: any) {
        console.error("Failed to load messages:", error);
        Alert.alert(
          "Error",
          error.response?.data?.message ||
            "Failed to load messages. Please try again.",
          [{ text: "Retry", onPress: loadMessages }]
        );
      } finally {
        setLoading(false);
      }
    };

    if (user?._id && contactId) {
      loadMessages();
    }
  }, [user?._id, contactId, chatId, chatName, contactAvatar, isGroup]);

  // Thêm hàm mới để load tin nhắn nhóm riêng
  const loadGroupMessages = async () => {
    try {
      // Get token from storage
      const token = await AsyncStorage.getItem("token");

      if (!token) {
        console.error("No auth token available for loading group messages");
        return;
      }

      console.log(`Fetching group messages for group ${contactId}`);

      // Try primary endpoint first
      try {
        const response = await axios.get(
          `${API_URL}/api/groups/${contactId}/messages`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        let messagesData = [];

        if (response.data) {
          if (Array.isArray(response.data)) {
            messagesData = response.data;
            console.log(
              `Loaded ${messagesData.length} group messages directly from response array`
            );
          } else if (
            response.data.messages &&
            Array.isArray(response.data.messages)
          ) {
            messagesData = response.data.messages;
            console.log(
              `Loaded ${messagesData.length} group messages from response.data.messages`
            );
          } else {
            console.log(
              "Unexpected response format for group messages:",
              response.data
            );
            return;
          }

          // Transform messages to UI format
          const formattedMessages = messagesData.map((msg: any) => {
            // Normalize sender format
            let sender = msg.sender || {};
            if (typeof sender === "string") {
              sender = {
                _id: sender,
                name: sender === user?._id ? user?.name || "You" : chatName,
                avt: sender === user?._id ? user?.avt || "" : contactAvatar,
              };
            } else if (!sender._id && msg.senderId) {
              sender = {
                _id: msg.senderId,
                name:
                  msg.senderId === user?._id ? user?.name || "You" : chatName,
                avt:
                  msg.senderId === user?._id ? user?.avt || "" : contactAvatar,
              };
            }

            return {
              _id: msg._id || msg.id || `temp-${Date.now()}-${Math.random()}`,
              content: msg.content || "",
              type: msg.type || "text",
              sender: {
                _id: sender._id || sender.id || "",
                name:
                  sender.name ||
                  `${sender.firstName || ""} ${sender.lastName || ""}`.trim() ||
                  "Unknown",
                avt: sender.avt || sender.avatar || "",
              },
              createdAt: msg.createdAt || new Date().toISOString(),
              reactions: msg.reactions || {},
              unsent: msg.unsent || false,
              fileUrl: msg.fileUrl || msg.file?.url || "",
              fileName: msg.fileName || msg.file?.name || "",
              roomId: msg.roomId || roomIdRef.current,
            };
          });

          // Sort newest first for FlatList
          if (formattedMessages.length > 0) {
            setMessages(formattedMessages.reverse());
          }
        }
      } catch (error) {
        console.error("Error loading group messages:", error);
        // Thử endpoint khác nếu endpoint chính thất bại
        try {
          console.log("Trying alternate endpoint...");
          const altResponse = await axios.get(
            `${API_URL}/api/chat/groups/${contactId}/messages`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (altResponse.data && Array.isArray(altResponse.data)) {
            console.log(
              `Loaded ${altResponse.data.length} group messages from alternate endpoint`
            );
            // Transform and set similar to above
          }
        } catch (altError) {
          console.error("Alternate endpoint failed:", altError);
        }
      }
    } catch (error) {
      console.error("Failed to load group messages:", error);
    }
  };

  // Set up periodic reload for group messages
  useEffect(() => {
    if (isGroup && contactId) {
      // Initial load
      loadGroupMessages();

      // Set up periodic reload every 10 seconds
      const intervalId = setInterval(() => {
        console.log("Periodic reload of group messages...");
        loadGroupMessages();
      }, 10000);

      // Cleanup interval on unmount
      return () => clearInterval(intervalId);
    }
  }, [isGroup, contactId]);

  // Optimize typing indicator with debounce
  const handleTyping = (text: string) => {
    setMessageText(text);

    // Send typing indicator with debounce (only for direct chats)
    if (user?._id && contactId && !isGroup) {
      // Clear any existing timeout
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }

      // Send typing status
      socketService.sendTypingStatus({
        sender: user._id,
        receiver: contactId,
      });

      // Set timeout to stop typing
      const timeout = setTimeout(() => {
        socketService.sendStopTypingStatus({
          sender: user._id,
          receiver: contactId,
        });
      }, 1000); // Reduce from 2000ms to 1000ms for faster feedback

      setTypingTimeout(timeout);
    }
  };

  // Improved sendMessage function with better error handling
  const sendMessage = async (
    content: string,
    type: string = "text",
    fileUrl?: string,
    fileName?: string,
    fileSize: number = 0
  ) => {
    if ((type === "text" && !content.trim()) || sending) return;

    try {
      setSending(true);

      // Get token from storage
      const token = await AsyncStorage.getItem("token");

      if (!token) {
        console.error("No auth token available for sending message");
        Alert.alert("Error", "Authentication required. Please log in again.");
        return;
      }

      // Get room ID from ref to ensure consistency
      const roomId =
        roomIdRef.current ||
        (isGroup ? contactId : `${[user?._id, contactId].sort().join("_")}`);

      // Generate temporary ID for optimistic UI update
      const tempId = `temp-${Date.now()}`;

      // Create message data structure with proper types
      const messageData: any = {
        roomId,
        content,
        type,
        tempId,
        chatType: isGroup ? "group" : "private",
        ...(replyingTo && { replyToId: replyingTo._id }),
        ...(fileUrl && { fileUrl }),
        ...(fileName && { fileName }),
        ...(fileSize > 0 && { fileSize }),
      };

      // Add group-specific or direct-specific fields
      if (isGroup) {
        messageData.groupId = contactId;
        messageData.sender = user?._id;
        messageData.senderId = user?._id;
      } else {
        messageData.receiver = contactId;
        messageData.sender = user?._id;
      }

      // Add message optimistically to UI
      const tempMessage: Message = {
        _id: tempId,
        content,
        sender: {
          _id: user?._id || "",
          name: user?.name || "You",
          avt: user?.avt || "",
        },
        createdAt: new Date().toISOString(),
        type: type as "text" | "image" | "video" | "audio" | "file",
        unsent: false,
        reactions: {},
        ...(replyingTo && {
          replyTo: {
            _id: replyingTo._id,
            content: replyingTo.content,
            sender: {
              _id: replyingTo.sender._id,
              name: replyingTo.sender.name,
              avt: replyingTo.sender.avt,
            },
          },
        }),
        ...(fileUrl && { fileUrl }),
        ...(fileName && { fileName }),
        ...(fileSize > 0 && { fileSize }),
        roomId,
        sending: true,
      };

      // For group chats, also add groupId
      if (isGroup) {
        tempMessage.groupId = contactId;
      }

      // Add message to UI first for better user experience
      setMessages((prevMessages) => [tempMessage, ...prevMessages]);

      // Clear input and reset replying state
      setMessageText("");
      setReplyingTo(null);

      // Send the message based on chat type
      let success = false;

      if (isGroup) {
        // For group messages
        console.log("Sending group message");
        success = await socketService.sendGroupMessage(messageData);
      } else {
        // For direct messages
        console.log("Sending direct message");

        // First try API for persistence
        try {
          const response = await axios.post(
            `${API_URL}/api/chat/messages`,
            messageData,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );

          if (response.data && response.data._id) {
            console.log("Message saved via API:", response.data._id);

            // Update UI with real message ID
            setMessages((prevMessages) =>
              prevMessages.map((msg) =>
                msg._id === tempId
                  ? {
                      ...msg,
                      _id: response.data._id,
                      sending: false,
                      tempId: tempId, // Lưu tempId gốc để so sánh sau này
                    }
                  : msg
              )
            );

            // Thêm flag vào tin nhắn socket để biết tin nhắn này đã được xử lý qua API
            socketService.sendMessage({
              ...messageData,
              _id: response.data._id,
              _alreadyProcessed: true,
              _sentViaApi: true,
            });

            success = true;
          }
        } catch (apiError) {
          console.error("API send failed, trying socket only:", apiError);

          // Try socket as fallback
          success = socketService.sendMessage(messageData);
        }
      }

      if (!success) {
        console.error("Failed to send message via all channels");
        setMessages((prevMessages) =>
          prevMessages.map((msg) =>
            msg._id === tempId ? { ...msg, sending: false, failed: true } : msg
          )
        );

        Alert.alert(
          "Message Failed",
          "Could not send your message. Tap to retry.",
          [
            {
              text: "Retry",
              onPress: () => {
                // Remove failed message and try again
                setMessages((prev) => prev.filter((msg) => msg._id !== tempId));
                setMessageText(content);
              },
            },
            {
              text: "Cancel",
              style: "cancel",
            },
          ]
        );
      }
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", "Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const handleImagePicker = async () => {
    try {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert("Yêu cầu quyền", "Cần quyền truy cập thư viện ảnh");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled) {
        const uri = result.assets[0].uri;
        const fileName = uri.split("/").pop() || "image.jpg";

        setIsUploading(true);
        setUploadProgress(0);

        try {
          // Thử tối đa 3 lần
          let cloudinaryResponse = null;
          let attempts = 0;
          const maxAttempts = 3;

          while (attempts < maxAttempts && !cloudinaryResponse) {
            attempts++;
            try {
              console.log(`Đang thử tải lên ảnh (lần thử ${attempts})...`);

              // Hiển thị thông báo khi đang tải lên
              if (attempts > 1) {
                setUploadProgress(0); // Reset progress for new attempt
                Alert.alert(
                  "Đang thử lại",
                  `Lần thử ${attempts}/${maxAttempts}`,
                  [],
                  { cancelable: true }
                );
              }

              cloudinaryResponse = await cloudinaryService.uploadImage(
                uri,
                "chat_image",
                (progress) => {
                  setUploadProgress(progress);
                }
              );

              console.log("Kết quả tải lên:", cloudinaryResponse);
            } catch (attemptError) {
              console.error(`Lỗi lần thử ${attempts}:`, attemptError);

              // Nếu đây không phải lần thử cuối, đợi 1 giây và thử lại
              if (attempts < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
              } else {
                throw attemptError; // Lỗi ở lần thử cuối cùng
              }
            }
          }

          if (cloudinaryResponse && cloudinaryResponse.secure_url) {
            console.log("Tải lên thành công:", cloudinaryResponse.secure_url);

            // Gửi tin nhắn với file đã upload
            sendMessage(
              "Hình ảnh",
              "image",
              cloudinaryResponse.secure_url,
              fileName,
              cloudinaryResponse.bytes || 0
            );
          } else {
            throw new Error("Không nhận được URL từ dịch vụ upload");
          }
        } catch (error) {
          console.error("Lỗi upload:", error);
          Alert.alert(
            "Lỗi tải lên",
            "Không thể tải lên ảnh. Vui lòng thử lại sau.",
            [
              {
                text: "Thử lại",
                onPress: () => handleImagePicker(),
              },
              {
                text: "Hủy",
                style: "cancel",
              },
            ]
          );
        } finally {
          setIsUploading(false);
          setUploadProgress(0);
        }
      }
    } catch (error) {
      console.error("Lỗi chọn ảnh:", error);
      Alert.alert("Lỗi", "Không thể chọn ảnh. Vui lòng thử lại.");
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDocumentPicker = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync();

      if (result.canceled) return;

      const asset = result.assets[0];
      const uri = asset.uri;
      const fileName = asset.name;
      const fileSize = asset.size || 0;
      const mimeType = asset.mimeType || "application/octet-stream";

      setIsUploading(true);
      setUploadProgress(0);

      // Thử tối đa 3 lần
      let attempts = 0;
      const maxAttempts = 3;
      let fileUrl = null;

      while (attempts < maxAttempts && !fileUrl) {
        attempts++;
        try {
          console.log(`Đang thử tải lên tài liệu (lần thử ${attempts})...`);

          if (attempts > 1) {
            setUploadProgress(0);
            Alert.alert(
              "Đang thử lại",
              `Lần thử tải tài liệu ${attempts}/${maxAttempts}`,
              [],
              { cancelable: true }
            );
          }

          // Lấy token từ storage
          const token = await AsyncStorage.getItem("token");
          if (!token) {
            Alert.alert("Lỗi", "Không tìm thấy token xác thực");
            setIsUploading(false);
            return;
          }

          // Create form data for upload
          const formData = new FormData();
          formData.append("file", {
            uri,
            name: fileName,
            type: mimeType,
          } as any);
          formData.append("type", "file");
          formData.append("senderId", user?._id || "");
          formData.append("receiverId", contactId || "");

          // Upload the file
          const response = await axios.post(
            `${API_URL}/api/chat/upload`,
            formData,
            {
              headers: {
                "Content-Type": "multipart/form-data",
                Authorization: `Bearer ${token}`,
              },
              timeout: 20000, // 20 giây cho tài liệu
              onUploadProgress: (progressEvent) => {
                if (progressEvent.total) {
                  const percentCompleted = Math.round(
                    (progressEvent.loaded * 100) / progressEvent.total
                  );
                  setUploadProgress(percentCompleted);
                }
              },
            }
          );

          if (response.data && response.data.fileUrl) {
            fileUrl = response.data.fileUrl;
            const serverFileName = response.data.fileName || fileName;
            const serverFileSize = response.data.fileSize || fileSize;

            console.log("Tải lên tài liệu thành công:", fileUrl);

            // Send the message with the file
            sendMessage(
              "Tài liệu",
              "file",
              fileUrl,
              serverFileName,
              serverFileSize
            );
            break;
          } else {
            throw new Error("Không nhận được URL từ server");
          }
        } catch (error) {
          console.error(`Lỗi lần thử ${attempts}:`, error);

          if (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          } else {
            // Lần thử cuối cùng thất bại, hiển thị lỗi
            Alert.alert(
              "Lỗi tải lên",
              "Không thể tải lên tài liệu. Vui lòng thử lại sau.",
              [
                {
                  text: "Thử lại",
                  onPress: () => handleDocumentPicker(),
                },
                {
                  text: "Hủy",
                  style: "cancel",
                },
              ]
            );
          }
        }
      }
    } catch (error) {
      console.error("Lỗi chọn tài liệu:", error);
      Alert.alert("Lỗi", "Không thể chọn tài liệu. Vui lòng thử lại.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setRecording(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      Alert.alert("Error", "Failed to start recording. Please try again.");
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;

    try {
      setRecording(false);
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI() || "";

      if (uri) {
        // Create form data for upload
        const formData = new FormData();
        formData.append("file", {
          uri,
          name: `audio_${Date.now()}.m4a`,
          type: "audio/m4a",
        } as any);
        formData.append("type", "audio");
        formData.append("senderId", user?._id || "");
        formData.append("receiverId", contactId || "");

        // Lấy token từ storage
        const token = await AsyncStorage.getItem("token");
        if (!token) {
          Alert.alert("Lỗi", "Không tìm thấy token xác thực");
          setIsUploading(false);
          return;
        }

        // Upload the file
        const response = await axios.post(
          `${API_URL}/api/chat/upload`,
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
              Authorization: `Bearer ${token}`,
            },
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percentCompleted = Math.round(
                  (progressEvent.loaded * 100) / progressEvent.total
                );
                setUploadProgress(percentCompleted);
              }
            },
          }
        );

        const { fileUrl, fileId, fileName, fileSize } = response.data;

        // Send the message with the file
        sendMessage("Audio message", "audio", fileUrl, fileName, fileSize);
      }
    } catch (error) {
      console.error("Failed to stop recording:", error);
      Alert.alert(
        "Error",
        "Failed to process audio recording. Please try again."
      );
    } finally {
      recordingRef.current = null;
    }
  };

  const handleReplyTo = (message: Message) => {
    setReplyingTo(message);
  };

  const cancelReply = () => {
    setReplyingTo(null);
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!user?._id) return;

    socketService.addReaction({
      messageId,
      userId: user._id,
      emoji,
    });
  };

  const handleUnsendMessage = async (
    message: Message,
    forEveryone: boolean = true
  ) => {
    if (!user?._id) return;

    try {
      // Cập nhật UI trước
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === message._id
            ? {
                ...msg,
                content: forEveryone ? "Tin nhắn đã bị thu hồi" : msg.content,
                unsent: forEveryone,
                deletedFor: forEveryone
                  ? undefined
                  : [...(msg.deletedFor || []), user._id],
              }
            : msg
        )
      );

      // Nếu thu hồi cho tất cả, gửi qua socket
      if (forEveryone) {
        socketService.unsendMessage({
          messageId: message._id,
          senderId: user._id,
          receiverId: contactId,
        });

        // API call để thu hồi tin nhắn cho tất cả
        const token = await AsyncStorage.getItem("token");
        await axios.put(
          `${API_URL}/api/chat/messages/${message._id}/unsend`,
          { forEveryone: true },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
      } else {
        // API call để xóa tin nhắn chỉ cho bản thân
        const token = await AsyncStorage.getItem("token");
        await axios.put(
          `${API_URL}/api/chat/messages/${message._id}/delete`,
          { forMe: true },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
      }
    } catch (error) {
      console.error("Failed to unsend/delete message:", error);
      Alert.alert("Lỗi", "Không thể thu hồi/xóa tin nhắn. Vui lòng thử lại.");
    }
  };

  const handleVideoPicker = async () => {
    try {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        Alert.alert("Yêu cầu quyền", "Cần quyền truy cập thư viện media");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "videos", // Sử dụng MediaType
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled) {
        const uri = result.assets[0].uri;
        const fileName = uri.split("/").pop() || "video.mp4";

        setIsUploading(true);
        setUploadProgress(0);

        // Thử tối đa 3 lần đối với video
        let attempts = 0;
        const maxAttempts = 3;
        let fileUrl = null;

        while (attempts < maxAttempts && !fileUrl) {
          attempts++;
          try {
            console.log(`Đang thử tải lên video (lần thử ${attempts})...`);

            if (attempts > 1) {
              setUploadProgress(0);
              Alert.alert(
                "Đang thử lại",
                `Lần thử tải video ${attempts}/${maxAttempts}`,
                [],
                { cancelable: true }
              );
            }

            // Đối với video, sử dụng phương thức upload thông thường qua API endpoint
            // Lấy token từ storage
            const token = await AsyncStorage.getItem("token");
            if (!token) {
              Alert.alert("Lỗi", "Không tìm thấy token xác thực");
              setIsUploading(false);
              return;
            }

            // Tạo FormData
            const formData = new FormData();
            formData.append("file", {
              uri,
              name: fileName,
              type: "video/mp4",
            } as any);
            formData.append("type", "video");
            formData.append("senderId", user?._id || "");
            formData.append("receiverId", contactId || "");

            const response = await axios.post(
              `${API_URL}/api/chat/upload`,
              formData,
              {
                headers: {
                  "Content-Type": "multipart/form-data",
                  Authorization: `Bearer ${token}`,
                },
                timeout: 30000, // Tăng timeout cho video lên 30 giây
                onUploadProgress: (progressEvent) => {
                  if (progressEvent.total) {
                    const percentCompleted = Math.round(
                      (progressEvent.loaded * 100) / progressEvent.total
                    );
                    setUploadProgress(percentCompleted);
                  }
                },
              }
            );

            if (response.data && response.data.fileUrl) {
              fileUrl = response.data.fileUrl;
              const serverFileName = response.data.fileName || fileName;
              const fileSize = response.data.fileSize || 0;

              console.log("Tải lên video thành công:", fileUrl);
              sendMessage("Video", "video", fileUrl, serverFileName, fileSize);
              break;
            } else {
              throw new Error("Không nhận được URL từ server");
            }
          } catch (error) {
            console.error(`Lỗi lần thử ${attempts}:`, error);

            if (attempts < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
            } else {
              // Lần thử cuối cùng thất bại, hiển thị lỗi
              Alert.alert(
                "Lỗi tải lên",
                "Không thể tải lên video. Vui lòng thử lại sau.",
                [
                  {
                    text: "Thử lại",
                    onPress: () => handleVideoPicker(),
                  },
                  {
                    text: "Hủy",
                    style: "cancel",
                  },
                ]
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("Lỗi chọn video:", error);
      Alert.alert("Lỗi", "Không thể chọn video. Vui lòng thử lại.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const openMediaPreview = (message: Message) => {
    setMediaPreview(message);
  };

  const closeMediaPreview = () => {
    setMediaPreview(null);
  };

  const handleDownloadFile = (message: Message) => {
    if (message.fileUrl) {
      // Mở file trong trình duyệt
      Linking.openURL(message.fileUrl);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    // Nếu tin nhắn đã bị xóa chỉ cho người dùng hiện tại, không hiển thị
    if (item.deletedFor?.includes(user?._id || "")) {
      return null;
    }

    const isMine = item.sender._id === user?._id;
    const formattedTime = moment(item.createdAt).format("HH:mm");
    const isFailed = (item as any).failed;

    const renderMessageContent = () => {
      if (item.unsent) {
        return <Text style={styles.unsent}>Tin nhắn đã bị thu hồi</Text>;
      }

      switch (item.type) {
        case "text":
          return <Text style={styles.messageText}>{item.content}</Text>;
        case "image":
          return (
            <TouchableOpacity onPress={() => openMediaPreview(item)}>
              <Image
                source={{ uri: item.fileUrl }}
                style={styles.imageMessage}
                resizeMode="cover"
              />
              <Text style={styles.fileName}>{item.fileName}</Text>
            </TouchableOpacity>
          );
        case "video":
          return (
            <TouchableOpacity
              style={styles.videoContainer}
              onPress={() => openMediaPreview(item)}
            >
              <View style={styles.videoThumbnail}>
                <Ionicons name="play-circle" size={40} color="#fff" />
              </View>
              <Text style={styles.fileName}>{item.fileName}</Text>
            </TouchableOpacity>
          );
        case "audio":
          return (
            <View style={styles.audioContainer}>
              <TouchableOpacity onPress={() => handleDownloadFile(item)}>
                <Ionicons name="musical-note" size={24} color="#2196F3" />
                <Text style={styles.fileName}>
                  {item.fileName || "Audio message"}
                </Text>
              </TouchableOpacity>
            </View>
          );
        case "file":
          return (
            <TouchableOpacity
              style={styles.fileContainer}
              onPress={() => handleDownloadFile(item)}
            >
              <Ionicons name="document-text" size={24} color="#ff9800" />
              <Text style={styles.fileName}>{item.fileName || "Document"}</Text>
            </TouchableOpacity>
          );
        default:
          return null;
      }
    };

    return (
      <View
        style={[
          styles.messageContainer,
          isMine ? styles.myMessageContainer : {},
        ]}
      >
        {!isMine && (
          <Image
            source={{
              uri:
                item.sender.avt ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(
                  item.sender.name
                )}`,
            }}
            style={styles.messageSenderAvatar}
          />
        )}

        <View
          style={[
            styles.messageBubble,
            isMine ? styles.myMessageBubble : {},
            isFailed ? styles.failedMessage : {},
          ]}
        >
          {item.replyTo && (
            <View style={styles.replyContainer}>
              <Text style={styles.replyText} numberOfLines={1}>
                {item.replyTo.content}
              </Text>
            </View>
          )}

          {renderMessageContent()}

          <Text style={styles.messageTime}>
            {formattedTime}
            {isFailed && " (Failed)"}
          </Text>

          {Object.keys(item.reactions || {}).length > 0 && (
            <View style={styles.reactionsContainer}>
              {Object.entries(item.reactions || {}).map(([userId, emoji]) => (
                <Text key={userId} style={styles.reaction}>
                  {emoji}
                </Text>
              ))}
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.messageOptions}
          onPress={() => {
            const options: AlertButton[] = [
              { text: "Trả lời", onPress: () => handleReplyTo(item) },
              {
                text: "Thả cảm xúc",
                onPress: () => {
                  setSelectedMessageForReaction(item._id);
                  setShowReactionMenu(true);
                },
              },
            ];

            // Thêm tùy chọn tải xuống cho file media
            if (
              item.type &&
              ["image", "video", "audio", "file"].includes(item.type)
            ) {
              options.push({
                text: "Lưu về thiết bị",
                onPress: () => handleDownloadFile(item),
              });
            }

            // Thêm tùy chọn thu hồi cho tin nhắn của người gửi
            if (isMine && !item.unsent) {
              options.push(
                {
                  text: "Thu hồi với mọi người",
                  onPress: () => handleUnsendMessage(item, true),
                },
                {
                  text: "Xóa chỉ với tôi",
                  onPress: () => handleUnsendMessage(item, false),
                }
              );
            } else if (!isMine) {
              // Tin nhắn người khác, chỉ cho phép xóa với mình
              options.push({
                text: "Xóa chỉ với tôi",
                onPress: () => handleUnsendMessage(item, false),
              });
            }

            options.push({ text: "Hủy", style: "cancel" });

            Alert.alert("Tùy chọn tin nhắn", "", options);
          }}
        >
          <Ionicons name="ellipsis-vertical" size={16} color="#999" />
        </TouchableOpacity>
      </View>
    );
  };

  // Show group info
  const showGroupInfo = () => {
    if (isGroup && groupInfo) {
      navigation.navigate("GroupInfo", {
        groupId: contactId,
        groupName: chatName,
        groupAvatar: contactAvatar,
      });
    }
  };

  // Tạo menu reaction dạng thanh dọc như trong ảnh
  const renderReactionMenu = () => {
    const reactions = ["👍", "❤️", "😂", "😮", "😳", "😡", "❌"];

    return (
      <Modal
        transparent={true}
        visible={showReactionMenu}
        animationType="fade"
        onRequestClose={() => setShowReactionMenu(false)}
      >
        <TouchableOpacity
          style={styles.reactionModalOverlay}
          activeOpacity={1}
          onPress={() => setShowReactionMenu(false)}
        >
          <View style={styles.reactionContainer}>
            {reactions.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.reactionButton}
                onPress={() => {
                  if (selectedMessageForReaction) {
                    handleReaction(selectedMessageForReaction, emoji);
                    setShowReactionMenu(false);
                    setSelectedMessageForReaction(null);
                  }
                }}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  // Component Media Preview
  const renderMediaPreview = () => {
    if (!mediaPreview) return null;

    return (
      <Modal
        transparent={true}
        visible={!!mediaPreview}
        animationType="fade"
        onRequestClose={closeMediaPreview}
      >
        <View style={styles.mediaPreviewContainer}>
          <TouchableOpacity
            style={styles.closePreviewButton}
            onPress={closeMediaPreview}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>

          {mediaPreview.type === "image" && (
            <Image
              source={{ uri: mediaPreview.fileUrl }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}

          {mediaPreview.type === "video" && (
            <Video
              source={{ uri: mediaPreview.fileUrl }}
              style={styles.previewVideo}
              controls={true}
              resizeMode="contain"
              paused={false}
            />
          )}

          {mediaPreview.type === "audio" && (
            <View style={styles.audioPreview}>
              <Text style={styles.audioTitle}>{mediaPreview.fileName}</Text>
              <AudioPlayer audioUri={mediaPreview.fileUrl || ""} />
            </View>
          )}

          <TouchableOpacity
            style={styles.downloadButton}
            onPress={() => {
              handleDownloadFile(mediaPreview);
              closeMediaPreview();
            }}
          >
            <Ionicons name="download" size={24} color="#fff" />
            <Text style={styles.downloadText}>Tải xuống</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  };

  // Hiển thị thanh tiến độ tải lên
  const renderUploadProgress = () => {
    if (!isUploading) return null;

    return (
      <View style={styles.uploadProgressContainer}>
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBar, { width: `${uploadProgress}%` }]} />
        </View>
        <Text
          style={styles.progressText}
        >{`Đang tải lên: ${uploadProgress}%`}</Text>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.headerCenter}
        onPress={() => {
          if (isGroup) {
            // Navigate to group details
            navigation.navigate("GroupDetails", { groupId: contactId });
          } else {
            // Navigate to contact details
            navigation.navigate("ContactDetail", {
              contactId,
              contactName: chatName,
            });
          }
        }}
      >
        <Text style={styles.headerTitle} numberOfLines={1}>
          {chatName}
        </Text>
        <Text style={styles.headerSubtitle}>
          {isGroup
            ? groupMembers.length > 0
              ? `${groupMembers.length} members`
              : "Loading members..."
            : "Online"}
        </Text>
      </TouchableOpacity>

      <View style={styles.headerRight}>
        {isGroup ? (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("GroupDetails", { groupId: contactId })
            }
            style={styles.headerButton}
          >
            <Ionicons
              name="information-circle-outline"
              size={24}
              color="#333"
            />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("ContactDetail", {
                contactId,
                contactName: chatName,
              })
            }
            style={styles.headerButton}
          >
            <Ionicons name="person" size={24} color="#333" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // Thêm menu attachment với UI đẹp hơn
  const renderAttachmentMenu = () => {
    return (
      <Modal
        transparent={true}
        visible={showAttachMenu}
        animationType="slide"
        onRequestClose={() => setShowAttachMenu(false)}
      >
        <TouchableOpacity
          style={styles.attachmentOverlay}
          activeOpacity={1}
          onPress={() => setShowAttachMenu(false)}
        >
          <View style={styles.attachmentContainer}>
            <Text style={styles.attachmentTitle}>Đính kèm file</Text>

            <View style={styles.attachmentOptions}>
              <TouchableOpacity
                style={styles.attachmentOption}
                onPress={() => {
                  handleImagePicker();
                  setShowAttachMenu(false);
                }}
              >
                <View
                  style={[
                    styles.attachmentIcon,
                    { backgroundColor: "#4caf50" },
                  ]}
                >
                  <Ionicons name="image" size={24} color="#fff" />
                </View>
                <Text style={styles.attachmentText}>Hình ảnh</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachmentOption}
                onPress={() => {
                  handleVideoPicker();
                  setShowAttachMenu(false);
                }}
              >
                <View
                  style={[
                    styles.attachmentIcon,
                    { backgroundColor: "#f44336" },
                  ]}
                >
                  <Ionicons name="videocam" size={24} color="#fff" />
                </View>
                <Text style={styles.attachmentText}>Video</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachmentOption}
                onPress={() => {
                  startRecording();
                  setShowAttachMenu(false);
                }}
              >
                <View
                  style={[
                    styles.attachmentIcon,
                    { backgroundColor: "#2196F3" },
                  ]}
                >
                  <Ionicons name="mic" size={24} color="#fff" />
                </View>
                <Text style={styles.attachmentText}>Âm thanh</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachmentOption}
                onPress={() => {
                  handleDocumentPicker();
                  setShowAttachMenu(false);
                }}
              >
                <View
                  style={[
                    styles.attachmentIcon,
                    { backgroundColor: "#ff9800" },
                  ]}
                >
                  <Ionicons name="document" size={24} color="#fff" />
                </View>
                <Text style={styles.attachmentText}>Tài liệu</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.closeAttachButton}
              onPress={() => setShowAttachMenu(false)}
            >
              <Text style={styles.closeAttachText}>Hủy</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      {renderHeader()}
      {renderReactionMenu()}
      {renderMediaPreview()}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoidingView}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {loading ? (
          <ActivityIndicator
            style={styles.loader}
            size="large"
            color="#2196F3"
          />
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item._id}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesListContent}
            inverted
          />
        )}

        {isTyping && (
          <View style={styles.typingIndicator}>
            <Text style={styles.typingText}>{chatName} đang nhập...</Text>
          </View>
        )}

        {renderUploadProgress()}

        {replyingTo && (
          <View style={styles.replyBar}>
            <View style={styles.replyInfo}>
              <Text style={styles.replyingTo}>
                Đang trả lời {replyingTo.sender.name}
              </Text>
              <Text style={styles.replyContent} numberOfLines={1}>
                {replyingTo.content}
              </Text>
            </View>
            <TouchableOpacity onPress={cancelReply} style={styles.cancelReply}>
              <Ionicons name="close" size={20} color="#666" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setShowAttachMenu(true)}
          >
            <Ionicons name="attach" size={24} color="#2196F3" />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Nhập tin nhắn..."
            value={messageText}
            onChangeText={handleTyping}
            multiline
          />

          {messageText.trim() ? (
            <TouchableOpacity
              style={styles.sendButton}
              onPress={() => sendMessage(messageText)}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.recordButton}
              onPressIn={startRecording}
              onPressOut={stopRecording}
            >
              <Ionicons
                name={recording ? "radio-button-on" : "mic-outline"}
                size={24}
                color={recording ? "#ff0000" : "#2196F3"}
              />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {renderAttachmentMenu()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 40,
    paddingBottom: 10,
    paddingHorizontal: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    padding: 5,
  },
  headerCenter: {
    flex: 1,
    marginLeft: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  headerSubtitle: {
    fontSize: 12,
    color: "#4caf50",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerButton: {
    paddingHorizontal: 10,
  },
  keyboardAvoidingView: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  messagesList: {
    flex: 1,
    padding: Platform.OS === "android" ? 5 : 10,
  },
  messagesListContent: {
    paddingTop: 10,
    paddingBottom: Platform.OS === "android" ? 5 : 10,
  },
  messageContainer: {
    flexDirection: "row",
    marginBottom: 15,
    alignItems: "flex-end",
  },
  myMessageContainer: {
    justifyContent: "flex-end",
  },
  messageSenderAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 5,
  },
  messageBubble: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 10,
    maxWidth: "75%",
    minWidth: 50,
    borderWidth: 1,
    borderColor: "#eee",
  },
  myMessageBubble: {
    backgroundColor: "#e3f2fd",
  },
  replyContainer: {
    padding: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#2196F3",
    backgroundColor: "rgba(33, 150, 243, 0.1)",
    borderRadius: 5,
    marginBottom: 5,
  },
  replyText: {
    fontSize: 12,
    color: "#555",
  },
  messageText: {
    fontSize: 16,
    color: "#333",
  },
  messageTime: {
    fontSize: 10,
    color: "#999",
    alignSelf: "flex-end",
    marginTop: 5,
  },
  unsent: {
    fontStyle: "italic",
    color: "#999",
  },
  imageMessage: {
    width: 200,
    height: 200,
    borderRadius: 10,
  },
  fileMessage: {
    flexDirection: "row",
    alignItems: "center",
    padding: 5,
  },
  fileMessageText: {
    marginLeft: 5,
    fontSize: 14,
    color: "#333",
  },
  reactionsContainer: {
    flexDirection: "row",
    marginTop: 5,
    alignItems: "center",
  },
  reaction: {
    fontSize: 16,
    marginRight: 3,
  },
  messageOptions: {
    marginLeft: 5,
    marginRight: 5,
    padding: 5,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 10,
    paddingBottom: Platform.OS === "android" ? 5 : 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  attachButton: {
    padding: 5,
    marginRight: 5,
  },
  input: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: "#2196F3",
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 10,
  },
  recordButton: {
    padding: 5,
    marginLeft: 10,
  },
  replyBar: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    alignItems: "center",
  },
  replyInfo: {
    flex: 1,
  },
  replyingTo: {
    fontSize: 12,
    color: "#2196F3",
    fontWeight: "bold",
  },
  replyContent: {
    fontSize: 14,
    color: "#666",
  },
  cancelReply: {
    padding: 5,
  },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  typingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  typingText: {
    fontSize: 12,
    color: "#666",
  },
  failedMessage: {
    borderColor: "#ff6b6b",
    backgroundColor: "#ffeeee",
  },
  reactionModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  reactionContainer: {
    flexDirection: "column",
    backgroundColor: "white",
    borderRadius: 10,
    padding: 5,
    marginHorizontal: 20,
    maxWidth: 60,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  reactionButton: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    width: "100%",
    alignItems: "center",
  },
  reactionEmoji: {
    fontSize: 24,
  },
  attachmentOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  attachmentContainer: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  attachmentTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  attachmentOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  attachmentOption: {
    width: "48%",
    marginBottom: 15,
    alignItems: "center",
  },
  attachmentIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 5,
  },
  attachmentText: {
    fontSize: 14,
    color: "#333",
  },
  closeAttachButton: {
    backgroundColor: "#f5f5f5",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  closeAttachText: {
    fontSize: 16,
    color: "#333",
  },
  mediaPreviewContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  closePreviewButton: {
    position: "absolute",
    top: 40,
    right: 20,
    zIndex: 10,
  },
  previewImage: {
    width: "100%",
    height: "80%",
  },
  previewVideo: {
    width: "100%",
    height: "80%",
  },
  audioPreview: {
    width: "80%",
    backgroundColor: "rgba(255,255,255,0.1)",
    padding: 20,
    borderRadius: 10,
    alignItems: "center",
  },
  audioTitle: {
    color: "white",
    fontSize: 16,
    marginBottom: 10,
  },
  downloadButton: {
    position: "absolute",
    bottom: 40,
    flexDirection: "row",
    backgroundColor: "rgba(33, 150, 243, 0.8)",
    padding: 12,
    borderRadius: 20,
    alignItems: "center",
  },
  downloadText: {
    color: "white",
    marginLeft: 5,
    fontSize: 16,
  },
  uploadProgressContainer: {
    backgroundColor: "white",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  progressBarContainer: {
    height: 10,
    backgroundColor: "#f0f0f0",
    borderRadius: 5,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#2196F3",
  },
  progressText: {
    marginTop: 5,
    textAlign: "center",
    fontSize: 12,
    color: "#666",
  },
  videoContainer: {
    width: 200,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 5,
  },
  videoThumbnail: {
    height: 150,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  fileName: {
    fontSize: 12,
    color: "#666",
    marginTop: 5,
  },
  audioContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
  },
  fileContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
  },
});

export default ChatDetailScreen;
