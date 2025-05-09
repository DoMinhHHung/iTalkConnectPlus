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
import { API_URL, getAPIURL, testAndSetAPIConnection } from "../../config/constants";
import moment from "moment";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Audio, Video, ResizeMode } from "expo-av";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import socketService from "../../services/socketService";
import { Socket } from "socket.io-client";
import groupChatService from "../../services/groupChatService";
import AudioPlayer from "../../components/AudioPlayer";
import * as cloudinaryService from "../../services/cloudinaryService";
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';

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

// Add this helper function near the top of the component
const ensureReactionsFormat = (reactions: any): Record<string, string> => {
  // If reactions is undefined or null, return empty object
  if (!reactions) return {};
  
  // If it's already a plain object, return it
  if (typeof reactions === 'object' && !Array.isArray(reactions) && !(reactions instanceof Map)) {
    // Ensure all values are strings
    const safeReactions: Record<string, string> = {};
    for (const [key, value] of Object.entries(reactions)) {
      if (typeof value === 'string') {
        safeReactions[key] = value;
      } else {
        // For any non-string value, use a default emoji
        safeReactions[key] = '👍';
      }
    }
    return safeReactions;
  }
  
  // Should never happen, but just in case
  console.warn("Unknown reactions format:", reactions);
  return {};
};

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
  const [attachment, setAttachment] = useState(null);

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

        // For group chats, use proper prefixed format for better compatibility with web
        if (isGroup) {
          // Join with standard group ID format
          socketService.joinChatRoom(roomId, true);
          
          // Also join with explicit group: prefix format to maximize compatibility
          if (socketRef.current) {
            socketRef.current.emit('joinRoom', { roomId: `group:${roomId}` });
            console.log(`[SOCKET DEBUG] Also joined with prefix format: group:${roomId}`);
            
            // Join with groupRoom format for newer servers
            socketRef.current.emit('joinGroupRoom', { groupId: roomId });
            console.log(`[SOCKET DEBUG] Also joined with groupRoom event: ${roomId}`);
          }
        } else {
          // For direct chat, handle both ways of joining
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
        }

        // Request missed messages using both formats for compatibility
        socketService.requestMissedMessages(roomId, isGroup);
        if (isGroup && socketRef.current) {
          socketRef.current.emit('getMissedMessages', { roomId: `group:${roomId}` });
        }

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

            if (isGroup) {
              // For group chat, rejoin with both formats
              socketService.joinChatRoom(roomId, true);
              
              if (socketRef.current) {
                socketRef.current.emit('joinRoom', { roomId: `group:${roomId}` });
                socketRef.current.emit('joinGroupRoom', { groupId: roomId });
              }
            } else {
              // For direct chat
              socketService.joinChatRoom(roomId, false);
              
              // Join personal room (some servers use this format)
              socketService.joinChatRoom(user._id, false);

              // Also join direct room with explicit sender/receiver
              const directRoomData = {
                sender: user._id,
                receiver: contactId,
              };
              
              if (socketRef.current) {
                socketRef.current.emit("joinDirectRoom", directRoomData);
              }
            }

            // Request missed messages with both formats
            socketService.requestMissedMessages(roomId, isGroup);
            if (isGroup && socketRef.current) {
              socketRef.current.emit('getMissedMessages', { roomId: `group:${roomId}` });
            }
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

          // Skip messages already processed via API
          if (newMessage._alreadyProcessed || newMessage._sentViaApi) {
            console.log(
              "[SOCKET DEBUG] Skipping message already processed via API"
            );
            return;
          }

          // Store message identifiers
          const messageId = newMessage._id;
          const tempId = newMessage._tempId || newMessage.tempId;
          const messageContent = newMessage.content;
          const messageTime = new Date(newMessage.createdAt).getTime();
          const senderId = typeof newMessage.sender === 'object' ? newMessage.sender._id : newMessage.sender;

          // Check if message belongs to current chat
          const messageGroupId = newMessage.groupId || (newMessage.room && newMessage.room.includes('group:') ? newMessage.room.replace('group:', '') : null);
          
          // For group messages, check if this message is for the current group
          if (isGroup && messageGroupId && messageGroupId !== contactId) {
            console.log(`[SOCKET DEBUG] Message for different group (${messageGroupId}), ignoring`);
            return;
          }

          // For direct messages, verify sender/receiver
          if (!isGroup && senderId !== user?._id && senderId !== contactId) {
            console.log(`[SOCKET DEBUG] Message from unrelated user (${senderId}), ignoring`);
            return;
          }

          // Check if message has already been tracked by socketService
          if (socketService.isMessageReceived(messageId, tempId)) {
            console.log(
              `[SOCKET DEBUG] Ignoring duplicate message tracked by socketService: ${messageId}/${tempId}`
            );
            return;
          }

          // Mark message as received by socketService
          socketService.markMessageReceived(messageId, tempId);

          setMessages((currentMessages) => {
            // Create a copy to check and avoid updating state unnecessarily
            const existingMessages = [...currentMessages];

            // Check if message already exists
            const isDuplicate = existingMessages.some((msg) => {
              // Check by ID
              if (msg._id === messageId) return true;

              // Check by tempId
              if (tempId && msg.tempId === tempId) return true;

              // Check for duplicates by content and time
              if (
                msg.content === messageContent &&
                msg.sender._id === senderId &&
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
              return currentMessages;
            }

            // Log message details
            console.log(
              `[SOCKET DEBUG] Processing message: ID=${messageId}, TempID=${tempId}, Sender=${senderId}`
            );

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
                    : newMessage.sender === user?._id
                    ? user?.name || "You"
                    : chatName,
                avt:
                  typeof newMessage.sender === "object"
                    ? newMessage.sender.avt || newMessage.sender.avatar || ""
                    : newMessage.sender === user?._id
                    ? user?.avt || ""
                    : contactAvatar,
              },
              createdAt: newMessage.createdAt || new Date().toISOString(),
              reactions: ensureReactionsFormat(newMessage.reactions || {}),
              unsent: newMessage.unsent || false,
              fileUrl: newMessage.fileUrl || newMessage.file?.url || "",
              fileName: newMessage.fileName || newMessage.file?.name || "",
              roomId: newMessage.roomId || roomIdRef.current,
              tempId: tempId,
            };

            // Add group-specific properties if it's a group message
            if (isGroup || newMessage.chatType === "group" || messageGroupId) {
              normalizedMessage.groupId = contactId;
            }

            // Update state with new message
            return [normalizedMessage, ...existingMessages];
          });

          // Mark as read if message is from the other person
          if (newMessage.sender._id !== user?._id) {
            console.log(`[SOCKET DEBUG] Marking message as read: ${messageId}`);
            socketService.markMessageAsRead({
              messageId: messageId,
              sender: typeof newMessage.sender === 'object' ? newMessage.sender._id : newMessage.sender,
              receiver: user?._id,
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
          (data: { messageId: string; userId: string; emoji: string; reactions?: Record<string, string> }) => {
            console.log("Received reaction update:", data);
            
            setMessages((prev) => 
              prev.map((msg) => {
                if (msg._id === data.messageId) {
                  // If the server sent full reactions object, use it
                  if (data.reactions) {
                    return {
                      ...msg,
                      reactions: ensureReactionsFormat(data.reactions),
                    };
                  } 
                  // Otherwise update just the specific reaction
                  else {
                    const updatedReactions = { ...(msg.reactions || {}) };
                    // Toggle behavior - add or remove based on existence
                    if (updatedReactions[data.userId] === data.emoji) {
                      delete updatedReactions[data.userId];
                    } else {
                      updatedReactions[data.userId] = data.emoji;
                    }
                    return {
                      ...msg,
                      reactions: updatedReactions,
                    };
                  }
                }
                return msg;
              })
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
            reactions: ensureReactionsFormat(msg.reactions || {}),
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
              reactions: ensureReactionsFormat(msg.reactions || {}),
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

      // Set up periodic reload every 5 seconds (reduced from 10 seconds)
      const intervalId = setInterval(() => {
        console.log("[SOCKET DEBUG] Periodic reload of group messages...");
        
        // Check if socket is still connected, reconnect if needed
        if (!socketRef.current || !socketRef.current.connected) {
          console.log("[SOCKET DEBUG] Socket disconnected, reconnecting...");
          socketService.initSocket().then(socket => {
            if (socket) {
              socketRef.current = socket;
              console.log("[SOCKET DEBUG] Socket reconnected, rejoining group...");
              
              // Join the group room with various formats
              socketService.joinChatRoom(contactId, true);
              socket.emit('joinRoom', { roomId: `group:${contactId}` });
              socket.emit('joinGroupRoom', { groupId: contactId });
              
              // Request missed messages
              socketService.requestMissedMessages(contactId, true);
            }
          });
        }
        
        // Always reload messages from API
        loadGroupMessages();
      }, 5000);

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
        
        try {
          // Try API first to ensure persistence
          const token = await AsyncStorage.getItem('token');
          if (!token) {
            throw new Error('No auth token available');
          }
          
          // Lấy API URL hiện tại
          const currentAPIURL = await getAPIURL();
          
          const apiResponse = await axios.post(
            `${currentAPIURL}/api/groups/message`,
            {
              groupId: contactId,
              content: content,
              type: type,
              tempId: tempId
            },
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (apiResponse.data && apiResponse.data._id) {
            console.log('Group message API response success:', apiResponse.data._id);
            
            // Update the temporary message with the real ID
            setMessages((prev) => 
              prev.map((msg) => 
                msg._id === tempId
                  ? { ...msg, _id: apiResponse.data._id, sending: false }
                  : msg
              )
            );
            
            success = true;
          }
        } catch (apiError) {
          console.error('Group API send failed:', apiError);
          
          // Nếu API thất bại, kiểm tra xem có thể do URL không đúng không
          if (apiError.message && apiError.message.includes('Network Error')) {
            // Thử thiết lập lại API URL
            console.log('Trying to reconnect with different API URL...');
            const reconnected = await testAndSetAPIConnection(true);
            if (reconnected) {
              // Thử gửi lại tin nhắn với URL mới
              try {
                const currentAPIURL = await getAPIURL();
                const token = await AsyncStorage.getItem('token');
                const retryResponse = await axios.post(
                  `${currentAPIURL}/api/groups/message`,
                  {
                    groupId: contactId,
                    content: content,
                    type: type,
                    tempId: tempId
                  },
                  {
                    headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json'
                    }
                  }
                );
                
                if (retryResponse.data && retryResponse.data._id) {
                  console.log('Group message retry success:', retryResponse.data._id);
                  setMessages((prev) => 
                    prev.map((msg) => 
                      msg._id === tempId
                        ? { ...msg, _id: retryResponse.data._id, sending: false }
                        : msg
                    )
                  );
                  success = true;
                }
              } catch (retryError) {
                console.error('Retry with new API URL also failed:', retryError);
              }
            }
          }
          
          // If API fails, try socket as fallback
          if (socketRef.current && socketRef.current.connected) {
            try {
              // Call the async function but handle the Promise properly
              groupChatService.emitGroupMessage({
                roomId: contactId,
                groupId: contactId,
                content: content,
                sender: user._id,
                senderId: user._id,
                type: type,
                tempId: tempId,
              }).then(socketSuccess => {
                if (socketSuccess) {
                  console.log("Group message sent successfully via socket");
                  // Update UI if needed
                  setMessages((prev) => 
                    prev.map((msg) => 
                      msg._id === tempId
                        ? { ...msg, sending: false }
                        : msg
                    )
                  );
                } else {
                  console.log("Socket send failed, group message may be delayed");
                }
              }).catch(socketError => {
                console.error("Error sending group message via socket:", socketError);
              });
              
              // Consider the attempt successful since we're handling the Promise
              success = true;
            } catch (socketError) {
              console.error('Socket fallback also failed:', socketError);
            }
          }
        }
      } else {
        // For direct messages
        console.log("Sending direct message");

        // First try API for persistence
        try {
          // Lấy API URL hiện tại
          const currentAPIURL = await getAPIURL();
          
          const response = await axios.post(
            `${currentAPIURL}/api/chat/messages`,
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

            // Emit message event to ensure both sender and receiver see the message
            if (socketRef.current && socketRef.current.connected) {
              // Thông báo cho socket rằng tin nhắn đã được lưu qua API
              socketRef.current.emit('messageStoredViaAPI', {
                ...messageData,
                _id: response.data._id
              });
            }

            // Do NOT send via socket if API succeeded
            success = true;
          }
        } catch (apiError) {
          console.error("API send failed, trying socket only:", apiError);
          
          // Nếu API thất bại, kiểm tra xem có thể do URL không đúng không
          if (apiError.message && apiError.message.includes('Network Error')) {
            // Thử thiết lập lại API URL
            console.log('Trying to reconnect with different API URL...');
            const reconnected = await testAndSetAPIConnection(true);
            if (reconnected) {
              // Thử gửi lại tin nhắn với URL mới
              try {
                const currentAPIURL = await getAPIURL();
                const retryResponse = await axios.post(
                  `${currentAPIURL}/api/chat/messages`,
                  messageData,
                  {
                    headers: {
                      Authorization: `Bearer ${token}`,
                      "Content-Type": "application/json",
                    },
                  }
                );
                
                if (retryResponse.data && retryResponse.data._id) {
                  console.log('Direct message retry success:', retryResponse.data._id);
                  setMessages((prev) => 
                    prev.map((msg) => 
                      msg._id === tempId
                        ? { ...msg, _id: retryResponse.data._id, sending: false }
                        : msg
                    )
                  );
                  success = true;
                  return;
                }
              } catch (retryError) {
                console.error('Retry with new API URL also failed:', retryError);
              }
            }
          }

          // Try socket as fallback
          if (socketRef.current && socketRef.current.connected) {
            try {
              // Call the async function but handle the Promise properly
              socketService.sendMessage(messageData)
                .then(socketSuccess => {
                  if (socketSuccess) {
                    console.log("Direct message sent successfully via socket");
                  } else {
                    console.log("Socket send failed, message may be delayed");
                  }
                })
                .catch(socketError => {
                  console.error("Error sending via socket:", socketError);
                });
              
              // Consider the attempt successful since we're handling the Promise
              success = true;
            } catch (socketError) {
              console.log('Socket connection error:', socketError);
            }
          } else {
            console.log('Socket not connected, cannot send via socket');
          }
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

      // Lấy token từ storage
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        Alert.alert("Lỗi", "Không tìm thấy token xác thực");
        setIsUploading(false);
        return;
      }

      console.log(`Đang tải lên tài liệu: ${fileName}, loại: ${mimeType}...`);

      try {
        // Sử dụng URL cứng để đảm bảo không có lỗi khi định dạng URL
        const directUploadURL = "http://192.168.1.3:3005/api/chat/upload-cloudinary";
        console.log(`Uploading to direct URL: ${directUploadURL}`);
        
        // Tạo FormData để tải lên
        const formData = new FormData();
        formData.append("file", {
          uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
          name: fileName,
          type: mimeType
        } as any);

        const response = await axios.post(
          directUploadURL,
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
              Authorization: `Bearer ${token}`,
            },
            timeout: 30000, // 30 giây
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

        console.log("Phản hồi từ server:", response.data);

        // Xử lý phản hồi từ server
        if (response.data && (response.data.file?.fileUrl || response.data.url)) {
          const fileUrl = response.data.file?.fileUrl || response.data.url;
          const serverFileName = response.data.file?.fileName || fileName;
          const serverFileSize = response.data.file?.fileSize || fileSize;

          console.log("Tải lên tài liệu thành công:", fileUrl);

          // Gửi tin nhắn với file đã tải lên
          sendMessage(
            "Tài liệu",
            "file",
            fileUrl,
            serverFileName,
            serverFileSize
          );
        } else {
          throw new Error("Không nhận được URL từ server");
        }
      } catch (uploadError: any) {
        console.error("Lỗi upload:", uploadError);
        
        // Thử sử dụng dịch vụ cloudinaryService trực tiếp
        console.log("Thử với cloudinaryService...");
        
        try {
          // Kiểm tra có phải lỗi timeout không
          const isTimeout = uploadError.message && uploadError.message.includes('timeout');
          
          // Thử endpoint thay thế nếu lỗi timeout
          if (isTimeout) {
            const altUploadURL = "http://192.168.1.3:3005/api/chat/upload";
            console.log(`Thử với URL thay thế: ${altUploadURL}`);
            
            const altFormData = new FormData();
            altFormData.append("file", {
              uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
              name: fileName,
              type: mimeType
            } as any);
            
            altFormData.append("type", "file");
            altFormData.append("senderId", user?._id || "");
            altFormData.append("receiverId", contactId || "");
            
            const altResponse = await axios.post(
              altUploadURL,
              altFormData,
              {
                headers: {
                  "Content-Type": "multipart/form-data",
                  Authorization: `Bearer ${token}`,
                },
                timeout: 60000, // 60 giây
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
            
            if (altResponse.data && altResponse.data.fileUrl) {
              console.log("Tải lên với URL thay thế thành công:", altResponse.data.fileUrl);
              
              sendMessage(
                "Tài liệu",
                "file",
                altResponse.data.fileUrl,
                altResponse.data.fileName || fileName,
                altResponse.data.fileSize || fileSize
              );
              return;
            }
          } else {
            throw uploadError; // Ném lỗi để xử lý bên dưới
          }
        } catch (finalError) {
          console.error("Tất cả các phương pháp tải lên đều thất bại:", finalError);
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
      // First ensure we're not already recording
      if (recording) {
        console.log("Already recording according to UI state");
        return;
      }

      // Request permissions first
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert("Cần quyền", "Ứng dụng cần quyền truy cập microphone để ghi âm");
        return;
      }

      // Clean up any existing recording reference
      if (recordingRef.current !== null) {
        console.log("Cleaning up existing recording reference");
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch (err) {
          // Ignore errors during cleanup
          console.log("Error during cleanup:", err);
        } finally {
          recordingRef.current = null;
        }
      }

      // Set audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        // Use numeric constants instead of named ones for compatibility
        interruptionModeIOS: 1, // Duck others mode
        interruptionModeAndroid: 1, // Duck others mode
      });

      console.log("Starting new recording...");
      
      // Create new recording
      const { recording: newRecording } = await Audio.Recording.createAsync(
        {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          android: {
            ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
            extension: '.m4a',
            // Use numeric constants for codec and format
            outputFormat: 2, // MPEG_4 format
          },
          ios: {
            ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
            extension: '.m4a',
            // Use numeric constant for AAC format
            outputFormat: 'aac', 
          }
        },
        (status) => console.log('Recording status:', status)
      );

      // Update state and refs
      recordingRef.current = newRecording;
      setRecording(true);
      
      console.log("Recording started successfully");
    } catch (error) {
      console.error("Failed to start recording:", error);
      Alert.alert("Lỗi", "Không thể bắt đầu ghi âm. Vui lòng thử lại.");
      
      // Reset state to be safe
      recordingRef.current = null;
      setRecording(false);
    }
  };

  const stopRecording = async () => {
    try {
      console.log("Stopping recording...");
      
      // Update UI state immediately
      setRecording(false);
      
      // Check if we have a valid recorder
      if (!recordingRef.current) {
        console.log("No recording to stop");
        return;
      }
      
      // Get recorder status to verify it's recording
      const status = await recordingRef.current.getStatusAsync();
      console.log("Recording status before stopping:", status);
      
      if (!status.isRecording) {
        console.log("Recorder exists but is not recording");
        recordingRef.current = null;
        return;
      }
      
      // Stop the recording
      await recordingRef.current.stopAndUnloadAsync();
      
      // Get URI safely
      let uri = '';
      try {
        uri = recordingRef.current.getURI() || '';
        console.log("Recording URI obtained:", uri);
      } catch (uriError) {
        console.error("Error getting recording URI:", uriError);
        recordingRef.current = null;
        throw new Error("Không thể lấy file ghi âm");
      }
      
      // Clear the recorder reference
      const tempRecordingRef = recordingRef.current;
      recordingRef.current = null;
      
      if (!uri) {
        throw new Error("Không có URI ghi âm");
      }
      
      // Start upload process
      await uploadAudioRecording(uri);
      
      // Clean up the temporary recording object
      try {
        await tempRecordingRef._cleanupForUnloadedRecorder();
      } catch (cleanupError) {
        console.log("Cleanup warning (non-critical):", cleanupError);
      }
      
    } catch (error) {
      console.error("Failed to process audio recording:", error);
      Alert.alert(
        "Lỗi Ghi Âm",
        "Không thể xử lý ghi âm. Vui lòng thử lại sau."
      );
      
      // Reset state
      recordingRef.current = null;
      setRecording(false);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };
  
  // Separate function to handle audio upload
  const uploadAudioRecording = async (uri) => {
    try {
      console.log("Starting audio upload process...");
      setIsUploading(true);
      setUploadProgress(0);
      
      // Create unique file name with correct extension
      const fileName = `audio_${Date.now()}.m4a`;
      
      // Get token from storage
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        throw new Error("Không tìm thấy token xác thực");
      }
      
      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
      const fileSize = fileInfo.exists ? (fileInfo as any).size || 0 : 0;
      console.log(`Audio file info: URI=${uri}, size=${fileSize}`);
      
      // ===== PHƯƠNG PHÁP 1: UPLOAD TRỰC TIẾP BẰNG FORMDATA =====
      try {
        console.log("Phương pháp 1: Upload trực tiếp với FormData");
        
        // Hardcoded URL để đảm bảo độ tin cậy
        const apiURL = "http://192.168.1.3:3005";
        const uploadURL = `${apiURL}/api/chat/upload-cloudinary`;
        console.log(`Uploading to: ${uploadURL}`);
        
        // Tạo FormData đơn giản
        const formData = new FormData();
        const fileToUpload = {
          uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
          type: 'audio/m4a',
          name: fileName
        } as any;
        
        formData.append('file', fileToUpload);
        
        // Upload với timeout dài
        const response = await axios.post(uploadURL, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': `Bearer ${token}`
          },
          timeout: 60000, // 60 giây
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const percentCompleted = Math.round(
                (progressEvent.loaded * 100) / progressEvent.total
              );
              setUploadProgress(percentCompleted);
            }
          }
        });
        
        console.log("Upload response:", response.data);
        
        if (response.data && (response.data.fileUrl || (response.data.file && response.data.file.fileUrl))) {
          const fileUrl = response.data.fileUrl || response.data.file.fileUrl;
          console.log("Success! File URL:", fileUrl);
          
          await sendMessage(
            "Tin nhắn thoại",
            "audio",
            fileUrl,
            fileName,
            fileSize
          );
          return;
        }
        
        throw new Error("Response không chứa fileUrl");
      } 
      catch (method1Error) {
        console.error("Phương pháp 1 thất bại:", method1Error);
        
        // ===== PHƯƠNG PHÁP 2: SỬ DỤNG EXPO FILESYSTEM =====
        try {
          console.log("Phương pháp 2: Upload với Fetch API");
          
          // Hardcoded URL 
          const apiURL = "http://192.168.1.3:3005";
          const uploadURL = `${apiURL}/api/chat/upload`;
          
          // Tạo form data với fetch
          const formData = new FormData();
          const fileToUpload = {
            uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
            type: 'audio/m4a',
            name: fileName
          } as any;
          
          formData.append('file', fileToUpload);
          formData.append('senderId', user?._id || '');
          formData.append('receiverId', contactId || '');
          formData.append('type', 'audio');
          
          // Sử dụng fetch thay vì axios
          const fetchResponse = await fetch(uploadURL, {
            method: 'POST',
            headers: {
              'Content-Type': 'multipart/form-data',
              'Authorization': `Bearer ${token}`
            },
            body: formData
          });
          
          if (!fetchResponse.ok) {
            throw new Error(`Fetch failed with status ${fetchResponse.status}`);
          }
          
          const responseData = await fetchResponse.json();
          console.log("Fetch response:", responseData);
          
          if (responseData && responseData.fileUrl) {
            console.log("Success! File URL:", responseData.fileUrl);
            
            await sendMessage(
              "Tin nhắn thoại",
              "audio",
              responseData.fileUrl,
              fileName,
              fileSize
            );
            return;
          }
          
          throw new Error("Fetch response không chứa fileUrl");
        } 
        catch (method2Error) {
          console.error("Phương pháp 2 thất bại:", method2Error);
          throw new Error("Tất cả phương pháp upload đều thất bại");
        }
      }
    } catch (error) {
      console.error("Audio upload error:", error);
      Alert.alert(
        "Lỗi Tải Lên",
        "Không thể tải lên tin nhắn thoại. Vui lòng thử lại sau."
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
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

    try {
      console.log(`Adding reaction ${emoji} to message ${messageId}`);
      
      // Optimistically update UI before server response
      setMessages((prev) => 
        prev.map((msg) => {
          if (msg._id === messageId) {
            const updatedReactions = { ...(msg.reactions || {}) };
            
            // Toggle reaction (add if not exists, remove if exists)
            if (updatedReactions[user._id] === emoji) {
              delete updatedReactions[user._id];
            } else {
              updatedReactions[user._id] = emoji;
            }
            
            return {
              ...msg,
              reactions: updatedReactions,
            };
          }
          return msg;
        })
      );

      // Send to server
      const success = await socketService.addReaction({
        messageId,
        userId: user._id,
        emoji,
      });
      
      if (!success) {
        console.error("Failed to send reaction via socket");
        // If socket fails, try API fallback
        try {
          const token = await AsyncStorage.getItem("token");
          await axios.post(
            `${API_URL}/api/chat/messages/${messageId}/reactions`,
            { emoji },
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );
        } catch (apiError) {
          console.error("API fallback for reaction also failed:", apiError);
        }
      }
    } catch (error) {
      console.error("Error sending reaction:", error);
    }
  };

  const handleUnsendMessage = async (
    message: Message,
    forEveryone: boolean = true
  ) => {
    if (!user?._id) return;

    // Keep track of success to show appropriate message
    let success = false;

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
        // Try socket first
        try {
          await socketService.unsendMessage({
            messageId: message._id,
            senderId: user._id,
            receiverId: contactId,
          });
          success = true;
        } catch (socketError) {
          console.error("Socket unsend error:", socketError);
          // Continue to API
        }

        try {
          // API call để thu hồi tin nhắn cho tất cả
          const token = await AsyncStorage.getItem("token");
          const response = await axios.put(
            `${API_URL}/api/chat/message/${message._id}/unsend`,
            { forEveryone: true },
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
          console.log("Message unsend API response:", response.status);
          success = true;
        } catch (apiError) {
          console.error("API unsend error:", apiError);
          // Continue if socket was successful
        }
      } else {
        // Try socket first for hide
        try {
          await socketService.hideMessage(message._id);
          success = true;
        } catch (socketError) {
          console.error("Socket hide error:", socketError);
          // Continue to API
        }

        try {
          // API call để xóa tin nhắn chỉ cho bản thân
          const token = await AsyncStorage.getItem("token");
          const response = await axios.post(
            `${API_URL}/api/chat/message/${message._id}/hide`,
            {},
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
          console.log("Message hide API response:", response.status);
          success = true;
        } catch (apiError) {
          console.error("API hide error:", apiError);
          // Continue if socket was successful
        }
      }

      if (!success) {
        throw new Error("Could not unsend message via any method");
      }
    } catch (error) {
      console.error("Failed to unsend/delete message:", error);
      
      // Revert UI changes if both methods failed
      if (!success) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === message._id
              ? {
                  ...msg,
                  content: message.content,
                  unsent: message.unsent || false,
                  deletedFor: message.deletedFor || [],
                }
              : msg
          )
        );
        
        Alert.alert("Lỗi", "Không thể thu hồi/xóa tin nhắn. Vui lòng thử lại.");
      }
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
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: 0.7,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });

      if (!result.canceled) {
        const uri = result.assets[0].uri;
        
        // Get actual file size
        const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
        const fileSize = fileInfo.exists ? fileInfo.size || 0 : 0;
        const fileName = uri.split("/").pop() || "video.mp4";
        
        // Show a confirmation for large videos
        if (fileSize > 20 * 1024 * 1024) { // 20MB
          Alert.alert(
            "Video lớn",
            `Video có kích thước ${Math.round(fileSize/1024/1024)}MB. Việc tải lên có thể mất nhiều thời gian. Tiếp tục?`,
            [
              {
                text: "Hủy",
                style: "cancel"
              },
              {
                text: "Tải lên",
                onPress: () => uploadVideoFile(uri, fileName, fileSize)
              }
            ]
          );
        } else {
          // Proceed with upload for smaller videos
          uploadVideoFile(uri, fileName, fileSize);
        }
      }
    } catch (error) {
      console.error("Lỗi chọn video:", error);
      Alert.alert("Lỗi", "Không thể chọn video. Vui lòng thử lại.");
    }
  };

  // Helper function to upload video using our improved cloudinaryService
  const uploadVideoFile = async (uri: string, fileName: string, fileSize: number) => {
    const tempId = `temp-${Date.now()}`; // Define tempId at function scope level for access throughout
    
    try {
      setIsUploading(true);
      setUploadProgress(0);
      
      // Add temporary message to show uploading status
      const tempMessage: Message = {
        _id: tempId,
        sender: {
          _id: user?._id || "",
          name: user?.name || "",
          avt: user?.avt || "",
        },
        content: "Đang tải lên video...",
        type: "video",
        roomId: roomIdRef.current || "",
        createdAt: new Date().toISOString(),
        sending: true,
        failed: false,
        unsent: false,
        reactions: {},
      };
      
      setMessages((prevMessages) => [tempMessage, ...prevMessages]);
      
      // Get authentication token
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        throw new Error("Không tìm thấy token xác thực");
      }
      
      console.log(`Uploading video: ${uri.substring(0, 50)}, size: ${Math.round(fileSize/1024/1024)}MB`);
      
      // Use our improved cloudinaryService.uploadFile function
      const result = await cloudinaryService.uploadFile(
        uri,
        {
          name: fileName,
          type: "video",
          size: fileSize
        },
        token,
        (progress) => {
          setUploadProgress(progress);
          
          // Also update the temporary message with progress
          setMessages((prevMessages) =>
            prevMessages.map((msg) =>
              msg._id === tempId
                ? { ...msg, content: `Đang tải lên video... ${progress}%` }
                : msg
            )
          );
        }
      );
      
      if (result && result.fileUrl) {
        console.log("Video uploaded successfully:", result.fileUrl);
        
        // Update temporary message or send a new message
        setMessages((prevMessages) =>
          prevMessages.map((msg) =>
            msg._id === tempId
              ? {
                  ...msg,
                  content: "Video message",
                  fileUrl: result.fileUrl,
                  fileName: result.fileName || fileName,
                  fileSize: result.fileSize || fileSize,
                  sending: false,
                }
              : msg
          )
        );
        
        // Send the message to server and other users
        await sendMessage(
          "Video message", 
          "video", 
          result.fileUrl, 
          result.fileName || fileName, 
          result.fileSize || fileSize
        );
      } else {
        throw new Error("Không có URL file được trả về");
      }
    } catch (error) {
      console.error("Lỗi tải lên video:", error);
      
      // Update the temporary message to show failure
      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          msg._id === tempId
            ? { ...msg, content: "Lỗi tải lên video", sending: false, failed: true }
            : msg
        )
      );
      
      Alert.alert(
        "Lỗi tải lên",
        `Không thể tải lên video: ${error.message}`,
        [
          {
            text: "Thử lại",
            onPress: () => {
              // Remove the failed message
              setMessages((prevMessages) => prevMessages.filter(msg => msg._id !== tempId));
              // Try again
              uploadVideoFile(uri, fileName, fileSize);
            }
          },
          {
            text: "Hủy",
            style: "cancel"
          }
        ]
      );
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

  const handleDownloadFile = async (message: Message) => {
    if (!message.fileUrl) {
      Alert.alert("Lỗi", "Không tìm thấy file");
      return;
    }
    
    try {
      setIsUploading(true);
      Alert.alert("Đang tải xuống...", "Vui lòng đợi trong giây lát");
      
      // Xác định kiểu tệp tin từ URL hoặc fileName
      const fileExtension = message.fileName ? 
        message.fileName.split('.').pop()?.toLowerCase() : 
        message.fileUrl.split('.').pop()?.toLowerCase();
        
      // Tên file tạm thời để lưu
      const tempFilename = `${FileSystem.cacheDirectory}document-${Date.now()}.${fileExtension}`;
      
      console.log(`Đang tải file từ: ${message.fileUrl}`);
      console.log(`Lưu vào: ${tempFilename}`);
      
      // Tải file về thiết bị
      const downloadResult = await FileSystem.downloadAsync(
        message.fileUrl,
        tempFilename
      );
      
      console.log("Kết quả tải xuống:", downloadResult);
      
      if (downloadResult.status === 200) {
        // Thử mở file với ứng dụng mặc định
        const fileUri = downloadResult.uri;
        
        // Xác định MIME type
        let mimeType = "application/octet-stream";
        if (fileExtension === "pdf") mimeType = "application/pdf";
        else if (["doc", "docx"].includes(fileExtension || "")) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        else if (["xls", "xlsx"].includes(fileExtension || "")) mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        else if (["ppt", "pptx"].includes(fileExtension || "")) mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        else if (fileExtension === "txt") mimeType = "text/plain";
        
        try {
          // Trên Android, thử mở với intent rõ ràng
          if (Platform.OS === 'android') {
            await Linking.openURL(`file://${fileUri}`);
          } else {
            // Trên iOS, sử dụng Share để mở với ứng dụng phù hợp
            await Linking.openURL(fileUri);
          }
        } catch (openError) {
          console.error("Không thể mở file trực tiếp:", openError);
          
          // Thử mở trong trình duyệt như phương án dự phòng
          Alert.alert(
            "Mở file",
            "Không thể mở file với ứng dụng trên thiết bị. Bạn có muốn mở trong trình duyệt không?",
            [
              {
                text: "Hủy",
                style: "cancel"
              },
              {
                text: "Mở trong trình duyệt",
                onPress: () => Linking.openURL(message.fileUrl || "")
              }
            ]
          );
        }
      } else {
        throw new Error("Tải xuống thất bại");
      }
    } catch (error) {
      console.error("Lỗi tải xuống file:", error);
      Alert.alert(
        "Lỗi",
        "Không thể tải xuống hoặc mở file. Vui lòng thử lại sau."
      );
      
      // Thử phương án dự phòng - mở trong trình duyệt
      Alert.alert(
        "Thử mở trong trình duyệt",
        "Bạn có muốn thử mở file trong trình duyệt không?",
        [
          {
            text: "Hủy",
            style: "cancel"
          },
          {
            text: "Mở",
            onPress: () => Linking.openURL(message.fileUrl || "")
          }
        ]
      );
    } finally {
      setIsUploading(false);
    }
  };

  // Helper function to safely handle reactions data
  const safelyRenderReactions = (reactions: any) => {
    if (!reactions) return null;
    
    try {
      // Now reactions should be a simple object where userId is the key and emoji is the value
      return (
        <View style={styles.reactionsContainer}>
          {Object.entries(reactions).map(([userId, emoji]) => (
            <Text key={userId} style={styles.reaction}>
              {typeof emoji === 'string' ? emoji : '👍'}
            </Text>
          ))}
        </View>
      );
    } catch (error) {
      console.error("Error rendering reactions:", error, reactions);
      return null;
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
              {!item.fileUrl ? (
                <View style={styles.audioErrorContainer}>
                  <Ionicons name="alert-circle" size={20} color="#ff6b6b" />
                  <Text style={styles.audioErrorText}>Audio không khả dụng</Text>
                </View>
              ) : (
                <>
                  <AudioPlayer audioUri={item.fileUrl} small={true} />
                  <Text style={styles.fileName}>{item.fileName || "Tin nhắn thoại"}</Text>
                </>
              )}
            </View>
          );
        case "file":
          return (
            <TouchableOpacity
              style={styles.fileContainer}
              onPress={() => handleDownloadFile(item)}
            >
              {(() => {
                const fileExt = item.fileName?.split('.').pop()?.toLowerCase() || '';
                
                if (fileExt === 'pdf') {
                  return <FontAwesome5 name="file-pdf" size={30} color="#FF5252" />;
                } else if (['doc', 'docx'].includes(fileExt)) {
                  return <FontAwesome5 name="file-word" size={30} color="#2196F3" />;
                } else if (['xls', 'xlsx'].includes(fileExt)) {
                  return <FontAwesome5 name="file-excel" size={30} color="#4CAF50" />;
                } else if (['ppt', 'pptx'].includes(fileExt)) {
                  return <FontAwesome5 name="file-powerpoint" size={30} color="#FF9800" />;
                } else if (['zip', 'rar', '7z'].includes(fileExt)) {
                  return <FontAwesome5 name="file-archive" size={30} color="#795548" />;
                } else {
                  return <FontAwesome5 name="file-alt" size={30} color="#607D8B" />;
                }
              })()}
              
              <View style={styles.fileInfoContainer}>
                <Text style={styles.fileName} numberOfLines={1}>{item.fileName || "Tài liệu"}</Text>
                {item.fileSize && (
                  <Text style={styles.fileSize}>
                    {item.fileSize < 1024 * 1024 
                      ? `${Math.round(item.fileSize / 1024)} KB` 
                      : `${Math.round((item.fileSize / 1024 / 1024) * 10) / 10} MB`}
                  </Text>
                )}
              </View>
              
              <TouchableOpacity 
                style={styles.fileDownloadButton}
                onPress={(e) => {
                  e.stopPropagation();
                  openMediaPreview(item);
                }}
              >
                <Ionicons name="eye-outline" size={20} color="#2196F3" />
              </TouchableOpacity>
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

          {item.reactions && Object.keys(item.reactions || {}).length > 0 && (
            safelyRenderReactions(item.reactions)
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
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
            />
          )}

          {mediaPreview.type === "audio" && (
            <View style={styles.audioPreview}>
              <View style={styles.audioPreviewHeader}>
                <Ionicons name="musical-note" size={40} color="#2196F3" />
                <Text style={styles.audioTitle}>{mediaPreview.fileName || "Tin nhắn thoại"}</Text>
              </View>
              <AudioPlayer audioUri={mediaPreview.fileUrl || ""} autoPlay={true} />
              <Text style={styles.audioSender}>
                Gửi bởi: {mediaPreview.sender.name}
              </Text>
              <Text style={styles.audioTime}>
                {moment(mediaPreview.createdAt).format("HH:mm, DD/MM/YYYY")}
              </Text>
            </View>
          )}

          {mediaPreview.type === "file" && (
            <View style={styles.documentPreview}>
              {/* Hiển thị biểu tượng dựa vào loại file */}
              {(() => {
                const fileExt = mediaPreview.fileName?.split('.').pop()?.toLowerCase() || '';
                if (fileExt === 'pdf') {
                  return <FontAwesome5 name="file-pdf" size={60} color="#FF5252" />;
                } else if (['doc', 'docx'].includes(fileExt)) {
                  return <FontAwesome5 name="file-word" size={60} color="#2196F3" />;
                } else if (['xls', 'xlsx'].includes(fileExt)) {
                  return <FontAwesome5 name="file-excel" size={60} color="#4CAF50" />;
                } else if (['ppt', 'pptx'].includes(fileExt)) {
                  return <FontAwesome5 name="file-powerpoint" size={60} color="#FF9800" />;
                } else if (['zip', 'rar', '7z'].includes(fileExt)) {
                  return <FontAwesome5 name="file-archive" size={60} color="#795548" />;
                } else if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
                  return <FontAwesome5 name="file-image" size={60} color="#03A9F4" />;
                } else {
                  return <FontAwesome5 name="file-alt" size={60} color="#607D8B" />;
                }
              })()}
              
              <Text style={styles.documentTitle}>
                {mediaPreview.fileName || "Tài liệu"}
              </Text>
              
              {mediaPreview.fileSize && (
                <Text style={styles.documentSize}>
                  {Math.round((mediaPreview.fileSize / 1024 / 1024) * 100) / 100} MB
                </Text>
              )}
              
              <Text style={styles.documentSender}>
                Được gửi bởi: {mediaPreview.sender.name}
              </Text>
              
              <Text style={styles.documentTime}>
                {moment(mediaPreview.createdAt).format("HH:mm, DD/MM/YYYY")}
              </Text>

              <View style={styles.documentActions}>
                <TouchableOpacity
                  style={[styles.documentButton, { backgroundColor: '#2196F3' }]}
                  onPress={() => {
                    handleDownloadFile(mediaPreview);
                    // Không đóng preview để người dùng có thể thử các tùy chọn khác nếu mở file thất bại
                  }}
                >
                  <FontAwesome5 name="download" size={20} color="#FFF" />
                  <Text style={styles.documentButtonText}>Tải xuống</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.documentButton, { backgroundColor: '#4CAF50' }]}
                  onPress={() => {
                    // Mở file trong trình duyệt
                    if (mediaPreview.fileUrl) {
                      Linking.openURL(mediaPreview.fileUrl);
                    }
                  }}
                >
                  <FontAwesome5 name="external-link-alt" size={20} color="#FFF" />
                  <Text style={styles.documentButtonText}>Mở trong trình duyệt</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={styles.downloadButton}
            onPress={() => {
              handleDownloadFile(mediaPreview);
              // Không đóng preview ngay để người dùng xem được tiến trình
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
    width: '85%',
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  audioPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    width: '100%',
  },
  audioTitle: {
    color: '#333',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
    flex: 1,
  },
  audioSender: {
    color: '#666',
    marginTop: 20,
    fontSize: 14,
    alignSelf: 'flex-start',
  },
  audioTime: {
    color: '#999',
    marginTop: 5,
    fontSize: 12,
    alignSelf: 'flex-start',
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
    overflow: 'hidden',
    marginBottom: 5,
  },
  videoThumbnail: {
    height: 150,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileName: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  fileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 8,
    marginVertical: 5,
    width: 220,
  },
  audioContainer: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    marginVertical: 3,
    width: 200,
  },
  audioErrorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  audioErrorText: {
    fontSize: 12,
    color: '#ff6b6b',
    marginLeft: 5,
  },
  documentPreview: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    marginBottom: 20,
  },
  documentTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  documentSize: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  documentSender: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  documentTime: {
    fontSize: 12,
    color: '#999',
    marginBottom: 20,
  },
  documentActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  documentButton: {
    flex: 1,
    padding: 10,
    borderRadius: 5,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  documentButtonText: {
    fontSize: 14,
    color: 'white',
  },
  fileInfoContainer: {
    flex: 1,
    marginLeft: 10,
  },
  fileSize: {
    fontSize: 12,
    color: '#999',
    marginTop: 5,
  },
  fileDownloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
});

export default ChatDetailScreen;
