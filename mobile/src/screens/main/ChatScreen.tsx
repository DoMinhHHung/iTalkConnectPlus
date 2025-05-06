import React, { useState, useEffect, useContext, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
  SafeAreaView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { AuthContext } from "../../context/AuthContext";
import { API_URL } from "../../config/constants";
import moment from "moment";
import AsyncStorage from "@react-native-async-storage/async-storage";
import socketService from "../../services/socketService";
import { Socket } from "socket.io-client";
import groupChatService from "../../services/groupChatService";

// Define interfaces based on server response format
interface LastMessage {
  id: string;
  content: string;
  type: string;
  senderId: string;
  createdAt: string;
  isRead: boolean;
}

interface Participant {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string;
  email?: string;
}

interface Chat {
  id: string;
  lastMessage: LastMessage;
  participants: Participant[];
  unreadCount: number;
  updatedAt: string;
  isGroup?: boolean;
  groupAvatar?: string;
  groupName?: string;
}

const ChatScreen = () => {
  const navigation = useNavigation<any>();
  const { user } = useContext(AuthContext);

  const [chats, setChats] = useState<Chat[]>([]);
  const [groupChats, setGroupChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [selectedTab, setSelectedTab] = useState<"direct" | "group">("direct");

  useEffect(() => {
    const setupSocket = async () => {
      socketRef.current = await socketService.initSocket();

      if (!socketRef.current) {
        console.error("Failed to initialize socket for chat list");
        return;
      }

      // Listen for new messages to update chat list
      socketRef.current.on("receiveMessage", (newMessage: any) => {
        console.log("Received new message in chat list");

        // Check if this message has already been processed to prevent duplicates
        const messageId = newMessage._id;
        const tempId = newMessage._tempId || newMessage.tempId;

        if (socketService.isMessageReceived(messageId, tempId)) {
          console.log(
            `Chat list ignoring duplicate message: ${messageId}/${tempId}`
          );
          return;
        }

        // Mark this message as received to prevent future duplicates
        socketService.markMessageReceived(messageId, tempId);

        const senderId =
          typeof newMessage.sender === "object"
            ? newMessage.sender._id
            : newMessage.sender;

        const receiverId =
          typeof newMessage.receiver === "object"
            ? newMessage.receiver._id
            : newMessage.receiver;

        // Check if this is a group message
        const isGroupMessage =
          newMessage.chatType === "group" || newMessage.groupId;
        const groupId = newMessage.groupId;

        // Only process if this message is relevant to current user
        if (
          !isGroupMessage &&
          senderId !== user?._id &&
          receiverId !== user?._id
        ) {
          return;
        }

        if (isGroupMessage) {
          // Handle group message
          updateGroupChatWithMessage(newMessage);
        } else {
          // Handle direct message
          // Find out who the other user is
          const otherUserId = senderId === user?._id ? receiverId : senderId;

          // Get sender name and avatar
          let senderName = "";
          let senderAvatar = "";
          if (typeof newMessage.sender === "object") {
            senderName =
              newMessage.sender.name ||
              `${newMessage.sender.firstName || ""} ${
                newMessage.sender.lastName || ""
              }`.trim();
            senderAvatar =
              newMessage.sender.avatar || newMessage.sender.avt || "";
          }

          // Update the chats list efficiently
          updateDirectChatWithMessage(
            newMessage,
            otherUserId,
            senderName,
            senderAvatar
          );
        }
      });

      // Listen for message read events
      socketRef.current.on(
        "messageStatusUpdate",
        (data: { messageId: string; status: string }) => {
          if (data.status === "seen") {
            setChats((prevChats) =>
              prevChats.map((chat) => {
                if (chat.lastMessage.id === data.messageId) {
                  return {
                    ...chat,
                    lastMessage: {
                      ...chat.lastMessage,
                      isRead: true,
                    },
                    unreadCount: 0,
                  };
                }
                return chat;
              })
            );

            setGroupChats((prevChats) =>
              prevChats.map((chat) => {
                if (chat.lastMessage.id === data.messageId) {
                  return {
                    ...chat,
                    lastMessage: {
                      ...chat.lastMessage,
                      isRead: true,
                    },
                    unreadCount: 0,
                  };
                }
                return chat;
              })
            );
          }
        }
      );

      // Listen for group events
      socketRef.current.on("groupUpdate", (data: any) => {
        console.log("Group update received:", data);
        loadGroupChats();
      });
    };

    setupSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.off("receiveMessage");
        socketRef.current.off("messageStatusUpdate");
        socketRef.current.off("groupUpdate");
      }
    };
  }, [user?._id]);

  // Function to update direct chat with new message
  const updateDirectChatWithMessage = (
    newMessage: any,
    otherUserId: string,
    senderName: string,
    senderAvatar: string
  ) => {
    setChats((prevChats) => {
      // Create new array reference to trigger render
      const updatedChats = [...prevChats];

      // Find existing chat with this user
      const existingChatIndex = updatedChats.findIndex((chat) =>
        chat.participants.some((p) => p.id === otherUserId)
      );

      if (existingChatIndex !== -1) {
        // Update existing chat
        const existingChat = updatedChats[existingChatIndex];

        // Only update if new message is newer than current last message
        const lastMessageTime = new Date(
          existingChat.lastMessage.createdAt
        ).getTime();
        const newMessageTime = new Date(newMessage.createdAt).getTime();

        if (newMessageTime <= lastMessageTime) {
          return prevChats; // No update needed
        }

        // Create updated chat object
        const updatedChat = {
          ...existingChat,
          lastMessage: {
            id: newMessage._id,
            content: newMessage.content || "",
            type: newMessage.type || "text",
            senderId:
              typeof newMessage.sender === "object"
                ? newMessage.sender._id
                : newMessage.sender,
            createdAt: newMessage.createdAt,
            isRead:
              typeof newMessage.sender === "object"
                ? newMessage.sender._id === user?._id
                : newMessage.sender === user?._id, // If we sent it, it's read
          },
          updatedAt: newMessage.createdAt,
        };

        // Increment unread count if message is from other user
        if (
          typeof newMessage.sender === "object"
            ? newMessage.sender._id !== user?._id
            : newMessage.sender !== user?._id
        ) {
          updatedChat.unreadCount = (existingChat.unreadCount || 0) + 1;
        }

        // Remove from current position
        updatedChats.splice(existingChatIndex, 1);
        // Move to top of list
        updatedChats.unshift(updatedChat);

        return updatedChats;
      } else {
        // Try to create a new chat entry with available information
        try {
          // Find participant info
          let otherParticipant: Participant | null = null;

          // Create default name from message if available
          if (
            typeof newMessage.sender === "object" &&
            (newMessage.sender._id === otherUserId ||
              newMessage.sender.id === otherUserId)
          ) {
            // Other user sent the message
            otherParticipant = {
              id: otherUserId,
              firstName: senderName.split(" ")[0] || "User",
              lastName: senderName.split(" ").slice(1).join(" ") || "",
              avatar: senderAvatar,
            };
          } else if (
            typeof newMessage.receiver === "object" &&
            (newMessage.receiver._id === otherUserId ||
              newMessage.receiver.id === otherUserId)
          ) {
            // Message to other user
            const receiver = newMessage.receiver;
            otherParticipant = {
              id: otherUserId,
              firstName: (receiver.name || "").split(" ")[0] || "User",
              lastName:
                (receiver.name || "").split(" ").slice(1).join(" ") || "",
              avatar: receiver.avatar || receiver.avt || "",
            };
          }

          if (otherParticipant) {
            // Create new chat entry
            const newChat: Chat = {
              id: `${user?._id}_${otherUserId}`,
              lastMessage: {
                id: newMessage._id,
                content: newMessage.content || "",
                type: newMessage.type || "text",
                senderId:
                  typeof newMessage.sender === "object"
                    ? newMessage.sender._id
                    : newMessage.sender,
                createdAt: newMessage.createdAt,
                isRead:
                  typeof newMessage.sender === "object"
                    ? newMessage.sender._id === user?._id
                    : newMessage.sender === user?._id,
              },
              participants: [
                {
                  id: user?._id || "",
                  firstName: (user?.name || "").split(" ")[0] || "You",
                  lastName:
                    (user?.name || "").split(" ").slice(1).join(" ") || "",
                  avatar: user?.avt || "",
                },
                otherParticipant,
              ],
              unreadCount:
                typeof newMessage.sender === "object"
                  ? newMessage.sender._id === user?._id
                    ? 0
                    : 1
                  : newMessage.sender === user?._id
                  ? 0
                  : 1,
              updatedAt: newMessage.createdAt,
              isGroup: false,
            };

            // Add to beginning of list
            updatedChats.unshift(newChat);
            return updatedChats;
          }
        } catch (err) {
          console.log("Error creating new chat entry:", err);
        }

        // If we couldn't create a chat entry with available info,
        // just return existing chats - we'll get full data on next refresh
        return prevChats;
      }
    });
  };

  // Function to update group chat with new message
  const updateGroupChatWithMessage = (newMessage: any) => {
    const groupId = newMessage.groupId;

    if (!groupId) return;

    setGroupChats((prevGroupChats) => {
      // Create new array reference
      const updatedGroupChats = [...prevGroupChats];

      // Find existing group chat
      const existingGroupIndex = updatedGroupChats.findIndex(
        (chat) => chat.id === groupId
      );

      if (existingGroupIndex !== -1) {
        // Update existing group chat
        const existingGroupChat = updatedGroupChats[existingGroupIndex];

        // Only update if new message is newer than current last message
        const lastMessageTime = new Date(
          existingGroupChat.lastMessage.createdAt
        ).getTime();
        const newMessageTime = new Date(newMessage.createdAt).getTime();

        if (newMessageTime <= lastMessageTime) {
          return prevGroupChats; // No update needed
        }

        // Create updated group chat object
        const updatedGroupChat = {
          ...existingGroupChat,
          lastMessage: {
            id: newMessage._id,
            content: newMessage.content || "",
            type: newMessage.type || "text",
            senderId:
              typeof newMessage.sender === "object"
                ? newMessage.sender._id
                : newMessage.sender,
            createdAt: newMessage.createdAt,
            isRead: false, // Group messages are always unread initially
          },
          updatedAt: newMessage.createdAt,
        };

        // Increment unread count if message is from other user
        if (
          typeof newMessage.sender === "object"
            ? newMessage.sender._id !== user?._id
            : newMessage.sender !== user?._id
        ) {
          updatedGroupChat.unreadCount =
            (existingGroupChat.unreadCount || 0) + 1;
        }

        // Remove from current position
        updatedGroupChats.splice(existingGroupIndex, 1);
        // Move to top of list
        updatedGroupChats.unshift(updatedGroupChat);

        return updatedGroupChats;
      }

      // If group chat not found, we'll wait for the regular load to get it
      return prevGroupChats;
    });
  };

  // Load both direct chats and group chats on mount
  useEffect(() => {
    loadChats();
    loadGroupChats();

    // Set up periodic refresh
    const interval = setInterval(() => {
      loadChats();
      loadGroupChats();
    }, 60000); // Refresh every 60 seconds as fallback

    return () => {
      clearInterval(interval);
    };
  }, []);

  const loadChats = async () => {
    try {
      // Get token from storage
      const token = await AsyncStorage.getItem("token");

      if (!token) {
        console.error("No auth token available");
        setError("Authentication required. Please log in again.");
        return;
      }

      console.log("Loading direct chats with token");

      // Tạo mảng để lưu trữ tất cả các cuộc trò chuyện
      let allChats: Chat[] = [];

      // 1. Trước tiên, cố gắng tải các cuộc trò chuyện hiện có
      try {
        console.log("Loading recent chats");
        const response = await axios.get(`${API_URL}/api/chat/recent`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 5000,
        });

        let chatData = [];

        if (response.data) {
          // Check if response contains array directly or nested
          if (Array.isArray(response.data)) {
            chatData = response.data;
          } else if (
            response.data.chats &&
            Array.isArray(response.data.chats)
          ) {
            chatData = response.data.chats;
          } else if (
            response.data.conversations &&
            Array.isArray(response.data.conversations)
          ) {
            chatData = response.data.conversations;
          } else if (
            response.data.rooms &&
            Array.isArray(response.data.rooms)
          ) {
            chatData = response.data.rooms;
          }

          console.log(`Successfully loaded ${chatData.length} existing chats`);

          if (chatData.length > 0) {
            const transformedChats = chatData
              .map((chat: any) => {
                // Filter out group chats - we'll handle them separately
                const isGroupChat =
                  chat.isGroup ||
                  chat.groupId ||
                  (chat.participants && chat.participants.length > 2);
                if (isGroupChat) {
                  return null;
                }

                // Extract participants
                let participants = chat.participants || [];

                if (!Array.isArray(participants) || participants.length === 0) {
                  // Try to reconstruct participants from sender/recipient
                  if (chat.sender && chat.recipient) {
                    participants = [
                      typeof chat.sender === "object"
                        ? chat.sender
                        : { _id: chat.sender },
                      typeof chat.recipient === "object"
                        ? chat.recipient
                        : { _id: chat.recipient },
                    ];
                  }
                }

                // Transform participants to expected format
                const transformedParticipants = participants.map((p: any) => ({
                  id: p._id || p.id,
                  firstName:
                    p.firstName || (p.name ? p.name.split(" ")[0] : ""),
                  lastName:
                    p.lastName ||
                    (p.name ? p.name.split(" ").slice(1).join(" ") : ""),
                  avatar: p.avatar || p.avt || "",
                  email: p.email || "",
                }));

                // Get last message
                let lastMessage = chat.lastMessage || {};
                if (chat.messages && chat.messages.length > 0) {
                  lastMessage = chat.messages[chat.messages.length - 1];
                }

                // Handle empty lastMessage by providing reasonable defaults
                if (!lastMessage || typeof lastMessage !== "object") {
                  lastMessage = {
                    _id: "",
                    content: "Start chatting",
                    type: "text",
                    sender: { _id: "" },
                    createdAt: new Date().toISOString(),
                    isRead: true,
                  };
                }

                return {
                  id:
                    chat._id ||
                    chat.id ||
                    `${chat.sender?._id}_${chat.recipient?._id}`,
                  lastMessage: {
                    id: lastMessage._id || lastMessage.id || "",
                    content: lastMessage.content || "",
                    type: lastMessage.type || "text",
                    senderId:
                      lastMessage.sender?._id || lastMessage.senderId || "",
                    createdAt:
                      lastMessage.createdAt || new Date().toISOString(),
                    isRead: lastMessage.isRead || false,
                  },
                  participants: transformedParticipants,
                  unreadCount: chat.unreadCount || 0,
                  updatedAt: chat.updatedAt || new Date().toISOString(),
                  isGroup: false,
                };
              })
              .filter(Boolean); // Remove null entries (group chats)

            // Thêm các cuộc trò chuyện hiện có vào mảng tất cả các cuộc trò chuyện
            allChats = [...transformedChats];
          }
        }
      } catch (err: any) {
        console.log("Chat loading error:", err.message);
      }

      // 2. Bây giờ, tải danh sách bạn bè để thêm vào danh sách cuộc trò chuyện nếu chưa có
      try {
        console.log("Loading friends list to add to direct messages");
        const friendsResponse = await axios.get(`${API_URL}/api/friendship`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 5000,
        });

        if (friendsResponse.data && Array.isArray(friendsResponse.data)) {
          const friendsList = friendsResponse.data;
          console.log(`Successfully loaded ${friendsList.length} friends`);

          // Chuyển đổi danh sách bạn bè thành các cuộc trò chuyện
          const friendChats = friendsList
            .map((friendship: any) => {
              // Xác định người dùng nào là bạn bè (không phải người dùng hiện tại)
              const friendData =
                friendship.requester && friendship.requester._id !== user?._id
                  ? friendship.requester
                  : friendship.recipient;

              // Bỏ qua nếu dữ liệu bạn bè bị thiếu
              if (!friendData) return null;

              // Kiểm tra xem bạn bè này đã có trong danh sách cuộc trò chuyện chưa
              const chatIdWithFriend = [user?._id, friendData._id]
                .sort()
                .join("_");
              const existingChatIndex = allChats.findIndex(
                (chat) =>
                  chat.id === chatIdWithFriend ||
                  chat.participants.some((p) => p.id === friendData._id)
              );

              // Nếu đã có cuộc trò chuyện với người này, bỏ qua
              if (existingChatIndex !== -1) {
                return null;
              }

              // Tạo một cuộc trò chuyện mới cho bạn bè này
              return {
                id: chatIdWithFriend,
                lastMessage: {
                  id: "",
                  content: "Start chatting",
                  type: "text",
                  senderId: "",
                  createdAt: new Date().toISOString(),
                  isRead: true,
                },
                participants: [
                  {
                    id: friendData._id,
                    firstName:
                      friendData.firstName ||
                      (friendData.name ? friendData.name.split(" ")[0] : ""),
                    lastName:
                      friendData.lastName ||
                      (friendData.name
                        ? friendData.name.split(" ").slice(1).join(" ")
                        : ""),
                    avatar: friendData.avt || friendData.avatar || "",
                    email: friendData.email || "",
                  },
                ],
                unreadCount: 0,
                updatedAt: friendship.updatedAt || new Date().toISOString(),
                isGroup: false,
              };
            })
            .filter(Boolean); // Loại bỏ các entry null

          // Thêm các cuộc trò chuyện bạn bè vào mảng tất cả các cuộc trò chuyện
          allChats = [...allChats, ...friendChats];
        }
      } catch (friendsError) {
        console.error("Failed to load friends for chat list:", friendsError);
      }

      // Sắp xếp tất cả các cuộc trò chuyện theo thời gian cập nhật mới nhất
      allChats.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      setChats(allChats);
      setError(null);
    } catch (error) {
      console.error("Failed to load chats:", error);
      if (error.response?.status === 401) {
        setError("Session expired. Please log in again.");
      } else {
        setError(`Error loading chats: ${error.message}`);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadGroupChats = async () => {
    try {
      // Get token from storage
      const token = await AsyncStorage.getItem("token");

      if (!token) {
        console.error("No auth token available for loading group chats");
        return;
      }

      console.log("Loading group chats");

      // Try the primary endpoint first
      try {
        // Get user's groups
        const response = await axios.get(`${API_URL}/api/groups/user/groups`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        let groupData = [];

        if (response.data) {
          groupData = Array.isArray(response.data)
            ? response.data
            : response.data.groups || response.data.data || [];

          console.log(
            `Successfully loaded ${groupData.length} group chats from primary endpoint`
          );

          await processGroupData(groupData, token);
          return;
        }
      } catch (primaryError) {
        console.log(`Primary group endpoint failed: ${primaryError.message}`);

        // Try alternate endpoint 1
        try {
          console.log("Trying alternate endpoint: /api/groups");
          const alt1Response = await axios.get(`${API_URL}/api/groups`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (alt1Response.data) {
            const groupData = Array.isArray(alt1Response.data)
              ? alt1Response.data
              : alt1Response.data.groups || [];

            console.log(
              `Successfully loaded ${groupData.length} group chats from alternate endpoint 1`
            );

            await processGroupData(groupData, token);
            return;
          }
        } catch (alt1Error) {
          console.log(
            `Alternate group endpoint 1 failed: ${alt1Error.message}`
          );

          // Try alternate endpoint 2
          try {
            console.log("Trying alternate endpoint: /api/chat/groups");
            const alt2Response = await axios.get(`${API_URL}/api/chat/groups`, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            if (alt2Response.data) {
              const groupData = Array.isArray(alt2Response.data)
                ? alt2Response.data
                : alt2Response.data.groups || [];

              console.log(
                `Successfully loaded ${groupData.length} group chats from alternate endpoint 2`
              );

              await processGroupData(groupData, token);
              return;
            }
          } catch (alt2Error) {
            console.log(
              `Alternate group endpoint 2 failed: ${alt2Error.message}`
            );
            // Fall through to the empty groups case
          }
        }

        // If all endpoints failed, set empty groups
        console.log("All group endpoints failed. Setting empty group list.");
        setGroupChats([]);
      }
    } catch (error) {
      console.error("Failed to load group chats:", error);
      // Set empty groups on error
      setGroupChats([]);
    }
  };

  // Helper function to process group data
  const processGroupData = async (groupData: any[], token: string) => {
    if (groupData.length > 0) {
      // Process group chat data
      const transformedGroupChats = await Promise.all(
        groupData.map(async (group: any) => {
          // Try to get the most recent message for this group
          let lastMessage = {
            id: "",
            content: "No messages yet",
            type: "text",
            senderId: "",
            createdAt: group.updatedAt || new Date().toISOString(),
            isRead: true,
          };

          try {
            // Get latest message for the group
            const messagesResponse = await axios.get(
              `${API_URL}/api/groups/${group._id}/messages`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
                params: {
                  limit: 1,
                },
                timeout: 3000, // Add timeout to prevent long waits
              }
            );

            if (messagesResponse.data && messagesResponse.data.length > 0) {
              const latestMessage = messagesResponse.data[0];
              lastMessage = {
                id: latestMessage._id,
                content: latestMessage.content || "",
                type: latestMessage.type || "text",
                senderId:
                  typeof latestMessage.sender === "object"
                    ? latestMessage.sender._id
                    : latestMessage.sender,
                createdAt: latestMessage.createdAt,
                isRead: false, // We'll assume group messages are unread initially
              };
            }
          } catch (err) {
            console.log(`Error getting messages for group ${group._id}:`, err);
          }

          // Get avatar from group or from members
          const groupAvatar = group.avatar || group.groupAvatar || "";

          // Get group ID and name properly
          const groupId = group._id || group.id;
          const groupName = group.name || group.groupName || "Group Chat";

          return {
            id: groupId,
            lastMessage,
            participants: (group.members || []).map((m: any) => ({
              id: m._id || m.id,
              firstName: m.firstName || (m.name ? m.name.split(" ")[0] : ""),
              lastName:
                m.lastName ||
                (m.name ? m.name.split(" ").slice(1).join(" ") : ""),
              avatar: m.avatar || m.avt || "",
            })),
            unreadCount: 0,
            updatedAt:
              lastMessage.createdAt ||
              group.updatedAt ||
              new Date().toISOString(),
            isGroup: true,
            groupName: groupName,
            groupAvatar: groupAvatar,
          };
        })
      );

      // Sort by most recent first
      transformedGroupChats.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      setGroupChats(transformedGroupChats);
    } else {
      setGroupChats([]);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadChats();
    loadGroupChats();
  };

  const navigateToCreateGroup = () => {
    navigation.navigate("CreateGroup");
  };

  const navigateToChatDetail = (chat: Chat) => {
    if (chat.isGroup) {
      // Navigate to group chat
      navigation.navigate("ChatDetail", {
        chatId: chat.id,
        chatName: chat.groupName || "Group Chat",
        contactId: chat.id, // For groups, contactId is the groupId
        contactAvatar: chat.groupAvatar || "",
        isGroup: true,
      });
    } else {
      // Navigate to individual chat
      // Find the other participant (not the current user)
      const otherParticipant = chat.participants.find(
        (p) => p.id !== user?._id
      );

      if (otherParticipant) {
        console.log(
          "Navigating to chat detail with:",
          otherParticipant.firstName,
          otherParticipant.lastName
        );
        navigation.navigate("ChatDetail", {
          chatId: chat.id,
          chatName: `${otherParticipant.firstName} ${otherParticipant.lastName}`,
          contactId: otherParticipant.id,
          contactAvatar: otherParticipant.avatar,
          isGroup: false,
        });
      } else {
        console.log("Could not find other participant in chat:", chat);
        // Fallback if we can't find other participant, check if it's a direct roomId (like "id1_id2")
        if (chat.id && chat.id.includes("_")) {
          const ids = chat.id.split("_");
          const otherId = ids[0] === user?._id ? ids[1] : ids[0];

          // Use the first participant's info as fallback
          const fallbackParticipant = chat.participants[0] || {
            id: otherId,
            firstName: "Unknown",
            lastName: "User",
            avatar: "",
          };

          navigation.navigate("ChatDetail", {
            chatId: chat.id,
            chatName:
              fallbackParticipant.firstName +
              " " +
              fallbackParticipant.lastName,
            contactId: otherId,
            contactAvatar: fallbackParticipant.avatar,
            isGroup: false,
          });
        }
      }
    }
  };

  const getFormattedTime = (dateString: string) => {
    const now = moment();
    const messageDate = moment(dateString);

    if (now.diff(messageDate, "days") === 0) {
      return messageDate.format("HH:mm"); // Today, just show time
    } else if (now.diff(messageDate, "days") < 7) {
      return messageDate.format("ddd"); // Within a week, show day name
    } else {
      return messageDate.format("DD/MM/YYYY"); // Otherwise show date
    }
  };

  const renderChatItem = ({ item }: { item: Chat }) => {
    if (item.isGroup) {
      // Render group chat item
      return (
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => navigateToChatDetail(item)}
        >
          <View style={styles.avatarContainer}>
            {item.groupAvatar ? (
              <Image source={{ uri: item.groupAvatar }} style={styles.avatar} />
            ) : (
              <View style={styles.groupAvatarPlaceholder}>
                {item.participants.slice(0, 4).map((participant, index) => (
                  <Image
                    key={participant.id}
                    source={{
                      uri:
                        participant.avatar ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(
                          `${participant.firstName} ${participant.lastName}`
                        )}`,
                    }}
                    style={[
                      styles.smallAvatar,
                      {
                        top: index < 2 ? 0 : "50%",
                        left: index % 2 === 0 ? 0 : "50%",
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>

          {item.unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
            </View>
          )}

          <View style={styles.chatInfo}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatName} numberOfLines={1}>
                {item.groupName || "Group Chat"}
              </Text>
              <Text style={styles.chatTime}>
                {getFormattedTime(item.lastMessage.createdAt)}
              </Text>
            </View>

            <View style={styles.chatPreviewContainer}>
              <Text
                style={[
                  styles.chatPreview,
                  !item.lastMessage.isRead &&
                  item.lastMessage.senderId !== user?._id
                    ? styles.unreadPreview
                    : {},
                ]}
                numberOfLines={1}
              >
                {item.lastMessage.senderId
                  ? `${
                      item.participants.find(
                        (p) => p.id === item.lastMessage.senderId
                      )?.firstName || "Someone"
                    }: `
                  : ""}
                {renderMessagePreview(item.lastMessage)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    } else {
      // Render direct chat item (existing code)
      // Find the other participant (not the current user)
      const otherParticipant = item.participants.find(
        (p) => p.id !== user?._id
      );

      if (!otherParticipant) return null;

      const displayName = `${otherParticipant.firstName} ${otherParticipant.lastName}`;
      const avatarUrl =
        otherParticipant.avatar ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`;

      const isOnline = socketService.isUserOnline(otherParticipant.id);

      return (
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => navigateToChatDetail(item)}
        >
          <View style={styles.avatarContainer}>
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            {isOnline && <View style={styles.onlineIndicator} />}
          </View>

          {item.unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
            </View>
          )}

          <View style={styles.chatInfo}>
            <View style={styles.chatHeader}>
              <Text style={styles.chatName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.chatTime}>
                {getFormattedTime(item.lastMessage.createdAt)}
              </Text>
            </View>

            <View style={styles.chatPreviewContainer}>
              <Text
                style={[
                  styles.chatPreview,
                  !item.lastMessage.isRead &&
                  item.lastMessage.senderId !== user?._id
                    ? styles.unreadPreview
                    : {},
                ]}
                numberOfLines={1}
              >
                {item.lastMessage.senderId === user?._id ? "You: " : ""}
                {renderMessagePreview(item.lastMessage)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    }
  };

  // Helper function to render message preview based on message type
  const renderMessagePreview = (message: LastMessage) => {
    switch (message.type) {
      case "text":
        return message.content;
      case "image":
        return "Photo";
      case "video":
        return "Video";
      case "audio":
        return "Audio message";
      case "file":
        return "Document";
      default:
        return "New message";
    }
  };

  // Combine direct and group chats, sorted by updatedAt
  const allChats = [...chats, ...groupChats].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const EmptyListComponent = () => {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="chatbubble-ellipses-outline" size={60} color="#ddd" />
        <Text style={styles.emptyText}>No conversations yet</Text>
        <Text style={styles.emptySubtext}>
          Your recent chats will appear here
        </Text>
      </View>
    );
  };

  // Update the header to include a create group button
  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Chats</Text>
      <TouchableOpacity
        style={styles.createGroupButton}
        onPress={navigateToCreateGroup}
      >
        <Ionicons name="people" size={22} color="#FFF" />
        <Text style={styles.createGroupText}>Group</Text>
      </TouchableOpacity>
    </View>
  );

  // Add renderGroupChatItem function
  const renderGroupChatItem = ({ item }: { item: any }) => {
    // Format timestamp
    const timestamp = formatMessageTime(item.updatedAt);

    // Get last message content with type consideration
    let lastMessageContent = "No messages yet";
    if (item.lastMessage) {
      if (item.lastMessage.type === "image") {
        lastMessageContent = "📷 Photo";
      } else if (item.lastMessage.type === "file") {
        lastMessageContent =
          "📎 File: " + (item.lastMessage.fileName || "Document");
      } else if (item.lastMessage.type === "audio") {
        lastMessageContent = "🎵 Audio";
      } else if (item.lastMessage.type === "video") {
        lastMessageContent = "🎬 Video";
      } else {
        lastMessageContent = item.lastMessage.content || "New message";
      }
    }

    return (
      <TouchableOpacity
        style={styles.chatItem}
        onPress={() => {
          navigation.navigate("ChatDetail", {
            chatId: item.id,
            chatName: item.groupName || "Group Chat",
            contactId: item.id,
            isGroup: true,
            contactAvatar: item.groupAvatar || "",
          });
        }}
      >
        <View style={styles.groupAvatarContainer}>
          {item.groupAvatar ? (
            <Image source={{ uri: item.groupAvatar }} style={styles.avatar} />
          ) : (
            <View style={styles.groupInitialsContainer}>
              <Text style={styles.groupInitialsText}>
                {(item.groupName || "G").charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatName} numberOfLines={1}>
              {item.groupName || "Group Chat"}
            </Text>
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>

          <View style={styles.lastMessageContainer}>
            <Text
              style={[
                styles.lastMessage,
                !item.lastMessage?.isRead && styles.unreadMessage,
              ]}
              numberOfLines={1}
            >
              {lastMessageContent}
            </Text>

            {item.unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {item.unreadCount > 99 ? "99+" : item.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Add renderEmptyGroupList function
  const renderEmptyGroupList = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="people" size={60} color="#ccc" />
      <Text style={styles.emptyText}>No group chats yet</Text>
      <TouchableOpacity
        style={styles.createFirstGroupButton}
        onPress={navigateToCreateGroup}
      >
        <Text style={styles.createFirstGroupButtonText}>Create Group Chat</Text>
      </TouchableOpacity>
    </View>
  );

  // Add formatMessageTime function
  const formatMessageTime = (timestamp: string): string => {
    if (!timestamp) return "";

    const messageDate = new Date(timestamp);
    const now = new Date();

    // Same day - show time
    if (messageDate.toDateString() === now.toDateString()) {
      return messageDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    // Within a week - show day of week
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);
    if (messageDate > weekAgo) {
      const options: Intl.DateTimeFormatOptions = { weekday: "short" };
      return messageDate.toLocaleDateString(undefined, options);
    }

    // Older than a week - show date
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
    };
    return messageDate.toLocaleDateString(undefined, options);
  };

  // Add styles for group chat UI
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "#fff",
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 15,
      paddingHorizontal: 20,
      backgroundColor: "#fff",
      borderBottomWidth: 1,
      borderBottomColor: "#eee",
      elevation: 2,
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: "bold",
      color: "#333",
      marginTop: 30,
    },
    createGroupButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#2196F3",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 20,
    },
    createGroupText: {
      color: "#FFF",
      marginLeft: 4,
      fontWeight: "600",
    },
    tabContainer: {
      flexDirection: "row",
      marginBottom: 10,
      paddingHorizontal: 16,
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    activeTab: {
      borderBottomColor: "#2196F3",
    },
    tabText: {
      color: "#999",
      fontWeight: "500",
    },
    activeTabText: {
      color: "#2196F3",
      fontWeight: "bold",
    },
    chatItem: {
      flexDirection: "row",
      padding: 15,
      borderBottomWidth: 1,
      borderBottomColor: "#eee",
      position: "relative",
    },
    avatarContainer: {
      position: "relative",
      marginRight: 15,
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
    },
    groupAvatarPlaceholder: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: "#e3f2fd",
      position: "relative",
      overflow: "hidden",
    },
    smallAvatar: {
      width: "50%",
      height: "50%",
      position: "absolute",
    },
    onlineIndicator: {
      position: "absolute",
      width: 12,
      height: 12,
      backgroundColor: "#4CAF50",
      borderRadius: 6,
      borderWidth: 2,
      borderColor: "#fff",
      bottom: 0,
      right: 0,
    },
    unreadBadge: {
      position: "absolute",
      top: 15,
      left: 50,
      backgroundColor: "#2196F3",
      borderRadius: 10,
      width: 20,
      height: 20,
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1,
    },
    unreadBadgeText: {
      color: "white",
      fontSize: 12,
      fontWeight: "bold",
    },
    chatInfo: {
      flex: 1,
      justifyContent: "center",
    },
    chatHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 5,
    },
    chatName: {
      fontSize: 16,
      fontWeight: "600",
      color: "#333",
      flex: 1,
    },
    chatTime: {
      fontSize: 12,
      color: "#999",
      marginLeft: 10,
    },
    chatPreviewContainer: {
      flexDirection: "row",
      alignItems: "center",
    },
    chatPreview: {
      fontSize: 14,
      color: "#666",
      flex: 1,
    },
    unreadPreview: {
      fontWeight: "bold",
      color: "#333",
    },
    loader: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    emptyContainer: {
      alignItems: "center",
      justifyContent: "center",
      marginTop: 100,
    },
    emptyList: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    emptyText: {
      fontSize: 18,
      fontWeight: "600",
      color: "#666",
      marginTop: 20,
    },
    emptySubtext: {
      fontSize: 14,
      color: "#999",
      marginTop: 5,
    },
    errorContainer: {
      padding: 20,
      backgroundColor: "#fff",
      borderWidth: 1,
      borderColor: "#eee",
      borderRadius: 5,
      margin: 20,
    },
    errorText: {
      color: "#f00",
      fontSize: 16,
      fontWeight: "bold",
      marginBottom: 20,
    },
    retryButton: {
      backgroundColor: "#2196F3",
      padding: 15,
      borderRadius: 5,
      alignItems: "center",
    },
    retryButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "bold",
    },
    groupAvatarContainer: {
      width: 50,
      height: 50,
      borderRadius: 25,
      marginRight: 12,
      justifyContent: "center",
      alignItems: "center",
      overflow: "hidden",
    },
    groupInitialsContainer: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: "#2196F3",
      justifyContent: "center",
      alignItems: "center",
    },
    groupInitialsText: {
      color: "#FFF",
      fontSize: 22,
      fontWeight: "bold",
    },
    createFirstGroupButton: {
      marginTop: 16,
      backgroundColor: "#2196F3",
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 20,
    },
    createFirstGroupButtonText: {
      color: "#FFF",
      fontWeight: "bold",
    },
    timestamp: {
      fontSize: 12,
      color: "#999",
    },
    lastMessageContainer: {
      flexDirection: "row",
      alignItems: "center",
    },
    lastMessage: {
      flex: 1,
    },
    unreadMessage: {
      fontWeight: "bold",
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}

      {/* Tabs for Direct and Group Chats */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, selectedTab === "direct" && styles.activeTab]}
          onPress={() => setSelectedTab("direct")}
        >
          <Text
            style={[
              styles.tabText,
              selectedTab === "direct" && styles.activeTabText,
            ]}
          >
            Direct Messages
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, selectedTab === "group" && styles.activeTab]}
          onPress={() => setSelectedTab("group")}
        >
          <Text
            style={[
              styles.tabText,
              selectedTab === "group" && styles.activeTabText,
            ]}
          >
            Group Chats
          </Text>
        </TouchableOpacity>
      </View>

      {selectedTab === "direct" ? (
        <FlatList
          data={chats}
          renderItem={renderChatItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
          ListEmptyComponent={EmptyListComponent}
        />
      ) : (
        <FlatList
          data={groupChats}
          renderItem={renderGroupChatItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
          ListEmptyComponent={renderEmptyGroupList}
        />
      )}
    </SafeAreaView>
  );
};

export default ChatScreen;
