import React, { useState, useEffect, useRef, useContext } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { AuthContext } from "../../context/AuthContext";
import * as groupChatService from "../../services/groupChatService";
import socketService from "../../services/socketService";
import { format } from "date-fns";
import uuid from "react-native-uuid";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { API_URL } from "../../config/api";
import { Video, ResizeMode } from "expo-av";
import ImageView from "react-native-image-viewing";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as cloudinaryService from "../../services/cloudinaryService";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";

interface Message {
  _id: string;
  content: string;
  sender: {
    _id: string;
    name: string;
    avt: string;
  };
  groupId: string;
  createdAt: string;
  type?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  reactions?: Record<string, string>;
  isUnsent?: boolean;
  tempId?: string;
  failed?: boolean;
  roomId?: string;
}

interface GroupChatParams {
  groupId: string;
  groupName: string;
}

interface Recording {
  stopAndUnloadAsync(): Promise<void>;
  getStatusAsync(): Promise<any>;
  getURI(): string | null;
  _cleanupForUnloadedRecorder(): Promise<void>;
}

const GroupChatScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useContext(AuthContext);
  const { groupId, groupName } = route.params as GroupChatParams;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isMounted, setIsMounted] = useState(true);
  const [typingUsers, setTypingUsers] = useState<{ [key: string]: string }>({});
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(
    null
  );
  const [isImageViewVisible, setIsImageViewVisible] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<any>(null);
  const recordingRef = useRef<any>(null);

  // Initialize and load messages
  useEffect(() => {
    setIsMounted(true);
    loadMessages();
    setupSocket();

    return () => {
      setIsMounted(false);
      cleanupSocket();
    };
  }, [groupId]);

  const setupSocket = async () => {
    try {
      // Get socket instance
      const socket = await socketService.initSocket();

      if (!socket) {
        console.error("Failed to get socket instance");
        return;
      }

      socketRef.current = socket;

      // Join the group room using both methods for compatibility
      console.log("Initializing group socket connection...");

      // Legacy method (should now call our new method internally)
      const joinLegacySuccess = await socketService.joinChatRoom(groupId, true);
      console.log(
        `Joined group chat room with legacy method: ${groupId}, success: ${joinLegacySuccess}`
      );

      // Also directly call new method for additional robustness
      const joinSuccess = await socketService.joinGroupRoom(groupId);
      console.log(
        `Joined group chat room with direct method: ${groupId}, success: ${joinSuccess}`
      );

      // Join with explicit group format as additional fallback
      if (socket.connected) {
        // Multiple message formats for maximum compatibility with server
        socket.emit("joinGroupRoom", { groupId });
        console.log(`Explicitly joined group room: ${groupId}`);

        socket.emit("joinRoom", { roomId: `group:${groupId}` });
        console.log(`Joined room (group): group:${groupId}`);
      } else {
        console.warn("Socket not connected when joining group room");
      }

      // Listen for new messages
      socket.off("groupMessage"); // Remove any existing listeners
      socket.on("groupMessage", handleNewMessage);

      // Listen for media messages specifically
      socket.off("groupMediaMessage");
      socket.on("groupMediaMessage", handleNewMessage);

      // Listen for other events
      socket.off("messageDeleted");
      socket.on("messageDeleted", handleMessageDeleted);

      socket.off("messageReaction");
      socket.on("messageReaction", handleMessageReaction);

      // Listen for typing events
      socket.off("userTyping");
      socket.on(
        "userTyping",
        (data: { userId: string; userName: string; groupId: string }) => {
          if (data.groupId === groupId && data.userId !== user._id) {
            console.log(`${data.userName} is typing...`);
            setTypingUsers((prev) => ({
              ...prev,
              [data.userId]: data.userName,
            }));

            // Auto remove typing indicator after 3 seconds
            setTimeout(() => {
              setTypingUsers((prev) => {
                const updated = { ...prev };
                delete updated[data.userId];
                return updated;
              });
            }, 3000);
          }
        }
      );

      socket.off("userStoppedTyping");
      socket.on(
        "userStoppedTyping",
        (data: { userId: string; groupId: string }) => {
          if (data.groupId === groupId) {
            setTypingUsers((prev) => {
              const updated = { ...prev };
              delete updated[data.userId];
              return updated;
            });
          }
        }
      );

      // Request any missed messages
      socketService.requestMissedMessages(groupId, true);
      console.log(`Requested missed messages for group: ${groupId}`);

      // Khi socket connect lại, join lại tất cả group đang mở
      socket.on("connect", () => {
        // join lại group hiện tại
        socket.emit("joinGroupRoom", { groupId });
        socket.emit("joinRoom", { roomId: `group:${groupId}` });
      });
    } catch (error) {
      console.error("Error setting up socket:", error);
    }
  };

  const cleanupSocket = () => {
    if (socketRef.current) {
      socketRef.current.off("groupMessage");
      socketRef.current.off("messageDeleted");
      socketRef.current.off("messageReaction");
      socketRef.current.off("userTyping");
      socketRef.current.off("userStoppedTyping");
      if (socketRef.current.connected) {
        socketRef.current.emit("leaveRoom", { roomId: `group:${groupId}` });
      }
    }
  };

  const loadMessages = async () => {
    try {
      setLoading(true);
      const groupMessages = await groupChatService.getGroupMessages(groupId);

      if (groupMessages && isMounted) {
        console.log(`Loaded ${groupMessages.length} group messages`);
        setMessages(groupMessages);
      }
    } catch (error) {
      console.error("Failed to load messages:", error);
    } finally {
      if (isMounted) {
        setLoading(false);
      }
    }
  };

  const handleNewMessage = (message: Message) => {
    console.log(`Group message received:`, message);

    // Only process messages for this group
    if (message.groupId !== groupId && message.roomId !== groupId) {
      console.log(
        `Ignoring message for different group: ${
          message.groupId || message.roomId
        }`
      );
      return;
    }

    // Check if this is a duplicate message
    const messageId = message._id;
    const tempId = message.tempId;

    // Check if we've already processed this message
    if (socketService.isMessageReceived(messageId, tempId)) {
      console.log(`Ignoring duplicate group message: ${messageId}/${tempId}`);
      return;
    }

    // Mark as received to avoid duplicates
    socketService.markMessageReceived(messageId, tempId);

    if (isMounted) {
      // Check for duplicates
      const isDuplicate = messages.some(
        (m) =>
          m._id === message._id ||
          (message.tempId && m.tempId === message.tempId)
      );

      if (isDuplicate) {
        return;
      }

      // Ensure message has all required fields
      const processedMessage = {
        ...message,
        sender: message.sender || {
          _id: user._id,
          name: user.name,
          avt: user.avt,
        },
      };

      setMessages((prevMessages) => {
        console.log(
          `Adding new message to state: ${message._id}, type: ${
            message.type || "text"
          }`
        );
        return [...prevMessages, processedMessage];
      });

      // Scroll to the new message
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  const handleMessageDeleted = (data: { messageId: string }) => {
    if (isMounted) {
      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          msg._id === data.messageId
            ? {
                ...msg,
                isUnsent: true,
                content: "This message has been deleted",
              }
            : msg
        )
      );
    }
  };

  const handleMessageReaction = (data: {
    messageId: string;
    userId: string;
    emoji: string;
  }) => {
    if (isMounted) {
      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
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
  };

  const handleTyping = (text: string) => {
    setInputMessage(text);

    // Send typing status to group
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("typing", {
        userId: user._id,
        userName: user.name,
        groupId: groupId,
        isGroup: true,
      });

      // Clear any existing timeout
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }

      // Set new timeout to stop typing after 2 seconds
      const timeout = setTimeout(() => {
        if (socketRef.current && socketRef.current.connected) {
          socketRef.current.emit("stopTyping", {
            userId: user._id,
            groupId: groupId,
            isGroup: true,
          });
        }
      }, 2000);

      setTypingTimeout(timeout);
    }
  };

  const sendMessage = async (
    content: string,
    type: string,
    fileUrl?: string,
    fileName?: string,
    fileSize?: number
  ) => {
    if (!content.trim()) return;

    try {
      setSending(true);

      // Create a temporary ID for the message
      const tempId = uuid.v4() as string;

      // Create temporary message to show immediately
      const tempMessage: Message = {
        _id: tempId,
        content: content.trim(),
        sender: {
          _id: user._id,
          name: user.name,
          avt: user.avt,
        },
        groupId: groupId,
        createdAt: new Date().toISOString(),
        tempId: tempId,
        type: type,
        fileUrl: fileUrl,
        fileName: fileName,
        fileSize: fileSize,
      };

      // Add to local messages for immediate feedback
      if (isMounted) {
        setMessages((prev) => [...prev, tempMessage]);
        setInputMessage("");

        // Scroll to the new message
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }

      console.log(
        `Sending group message: ${tempMessage.content} to group ${groupId} with tempId ${tempId}`
      );

      // Ensure socket is connected and joined room
      if (!socketRef.current || !socketRef.current.connected) {
        console.log("Socket not connected, reconnecting...");
        try {
          const socket = await socketService.initSocket();
          if (socket) {
            socketRef.current = socket;
            // Rejoin the group room
            socket.emit("joinGroupRoom", { groupId });
            socket.emit("joinRoom", { roomId: `group:${groupId}` });
            console.log(`Rejoined group room: ${groupId}`);
          }
        } catch (error) {
          console.error("Failed to reconnect socket:", error);
        }
      }

      // Try socket first
      let socketSuccess = false;
      if (socketRef.current && socketRef.current.connected) {
        try {
          const messageData = {
            roomId: groupId,
            groupId: groupId,
            content: tempMessage.content,
            sender: {
              _id: user._id,
              name: user.name,
              avt: user.avt,
            },
            senderId: user._id,
            type: type,
            tempId: tempId,
            fileUrl: fileUrl,
            fileName: fileName,
            fileSize: fileSize,
          };

          socketSuccess = await groupChatService.emitGroupMessage(messageData);
          console.log(
            `Socket send result: ${socketSuccess ? "success" : "failed"}`
          );
        } catch (socketError) {
          console.error("Socket send error:", socketError);
        }
      } else {
        console.log("Socket not connected, skipping socket send");
      }

      // If socket failed or not connected, fall back to API
      if (!socketSuccess) {
        console.log("Falling back to API for group message");
        try {
          const token = await AsyncStorage.getItem("token");
          if (!token) {
            throw new Error("No auth token available");
          }

          const apiResponse = await axios.post(
            `${API_URL}/api/groups/message`,
            {
              groupId: groupId,
              content: tempMessage.content,
              type: type,
              tempId: tempId,
              sender: {
                _id: user._id,
                name: user.name,
                avt: user.avt,
              },
              fileUrl: fileUrl,
              fileName: fileName,
              fileSize: fileSize,
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );

          console.log(
            "Group message API response:",
            apiResponse.status,
            apiResponse.data && apiResponse.data._id
          );

          if (apiResponse.data && apiResponse.data._id) {
            // Update the temporary message with the real ID
            setMessages((prev) =>
              prev.map((msg) =>
                msg.tempId === tempId
                  ? { ...msg, _id: apiResponse.data._id }
                  : msg
              )
            );
          }
        } catch (apiError) {
          console.error("API send failed:", apiError);
          // Mark message as failed in UI
          setMessages((prev) =>
            prev.map((msg) =>
              msg.tempId === tempId ? { ...msg, failed: true } : msg
            )
          );

          Alert.alert(
            "Lỗi gửi tin nhắn",
            "Không thể gửi tin nhắn. Bạn có muốn thử lại?",
            [
              {
                text: "Thử lại",
                onPress: () => {
                  // Remove failed message and try again
                  setMessages((prev) =>
                    prev.filter((msg) => msg.tempId !== tempId)
                  );
                  setInputMessage(tempMessage.content);
                },
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
      console.error("Error sending message:", error);
    } finally {
      if (isMounted) {
        setSending(false);
      }
    }
  };

  const navigateToGroupDetails = () => {
    navigation.navigate("GroupDetails", { groupId });
  };

  const handleImagePress = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setIsImageViewVisible(true);
  };

  const handleVideoPress = (videoUrl: string) => {
    setSelectedVideo(videoUrl);
    setIsVideoVisible(true);
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
          const cloudinaryResponse = await cloudinaryService.uploadImage(
            uri,
            "chat_image",
            (progress) => {
              setUploadProgress(progress);
            }
          );

          if (cloudinaryResponse && cloudinaryResponse.secure_url) {
            sendMessage(
              "Hình ảnh",
              "image",
              cloudinaryResponse.secure_url,
              fileName,
              cloudinaryResponse.bytes || 0
            );
          }
        } catch (error) {
          console.error("Lỗi upload:", error);
          Alert.alert("Lỗi", "Không thể tải lên ảnh. Vui lòng thử lại.");
        }
      }
    } catch (error) {
      console.error("Lỗi chọn ảnh:", error);
      Alert.alert("Lỗi", "Không thể chọn ảnh. Vui lòng thử lại.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
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
        const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
        const fileSize = fileInfo.exists ? fileInfo.size || 0 : 0;
        const fileName = uri.split("/").pop() || "video.mp4";

        if (fileSize > 20 * 1024 * 1024) {
          Alert.alert(
            "Video lớn",
            `Video có kích thước ${Math.round(
              fileSize / 1024 / 1024
            )}MB. Việc tải lên có thể mất nhiều thời gian. Tiếp tục?`,
            [
              { text: "Hủy", style: "cancel" },
              {
                text: "Tải lên",
                onPress: () => uploadVideoFile(uri, fileName, fileSize),
              },
            ]
          );
        } else {
          uploadVideoFile(uri, fileName, fileSize);
        }
      }
    } catch (error) {
      console.error("Lỗi chọn video:", error);
      Alert.alert("Lỗi", "Không thể chọn video. Vui lòng thử lại.");
    }
  };

  const uploadVideoFile = async (
    uri: string,
    fileName: string,
    fileSize: number
  ) => {
    const tempId = `temp-${Date.now()}`;

    try {
      setIsUploading(true);
      setUploadProgress(0);

      const token = await AsyncStorage.getItem("token");
      if (!token) {
        throw new Error("Không tìm thấy token xác thực");
      }

      const result = await cloudinaryService.uploadFile(
        uri,
        {
          name: fileName,
          type: "video",
          size: fileSize,
        },
        token,
        (progress) => {
          setUploadProgress(progress);
        }
      );

      if (result && result.fileUrl) {
        await sendMessage(
          "Video message",
          "video",
          result.fileUrl,
          result.fileName || fileName,
          result.fileSize || fileSize
        );
      }
    } catch (error) {
      console.error("Lỗi tải lên video:", error);
      Alert.alert("Lỗi", "Không thể tải lên video. Vui lòng thử lại.");
    } finally {
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

      const token = await AsyncStorage.getItem("token");
      if (!token) {
        Alert.alert("Lỗi", "Không tìm thấy token xác thực");
        return;
      }

      try {
        const cloudinaryResponse = await cloudinaryService.uploadFile(
          uri,
          {
            name: fileName,
            type: "file",
            size: fileSize,
          },
          token,
          (progress) => {
            setUploadProgress(progress);
          }
        );

        if (cloudinaryResponse && cloudinaryResponse.fileUrl) {
          await sendMessage(
            "Tài liệu",
            "file",
            cloudinaryResponse.fileUrl,
            fileName,
            fileSize
          );
        }
      } catch (error) {
        console.error("Lỗi upload:", error);
        Alert.alert("Lỗi", "Không thể tải lên tài liệu. Vui lòng thử lại.");
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
      if (recording) return;

      const { granted } = await Audio.getPermissionsAsync();
      if (!granted) {
        const { granted: newGranted } = await Audio.requestPermissionsAsync();
        if (!newGranted) {
          Alert.alert(
            "Cần quyền",
            "Ứng dụng cần quyền truy cập microphone để ghi âm"
          );
          return;
        }
      }

      if (recordingRef.current !== null) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch (err) {
          console.log("Error during cleanup:", err);
        } finally {
          recordingRef.current = null;
        }
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync({
        android: {
          extension: ".m4a",
          outputFormat: 2,
          audioEncoder: 3,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
        },
        ios: {
          extension: ".m4a",
          outputFormat: "aac",
          audioQuality: 0.8,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: "audio/webm",
          bitsPerSecond: 128000,
        },
      });

      recordingRef.current = newRecording;
      setRecording(true);
    } catch (error) {
      console.error("Failed to start recording:", error);
      Alert.alert("Lỗi", "Không thể bắt đầu ghi âm. Vui lòng thử lại.");
      recordingRef.current = null;
      setRecording(false);
    }
  };

  const stopRecording = async () => {
    try {
      setRecording(false);

      if (!recordingRef.current) return;

      const status = await recordingRef.current.getStatusAsync();
      if (!status.isRecording) {
        recordingRef.current = null;
        return;
      }

      await recordingRef.current.stopAndUnloadAsync();

      let uri = recordingRef.current.getURI() || "";
      const tempRecordingRef = recordingRef.current;
      recordingRef.current = null;

      if (!uri) {
        throw new Error("Không có URI ghi âm");
      }

      await uploadAudioRecording(uri);

      try {
        await tempRecordingRef._cleanupForUnloadedRecorder();
      } catch (cleanupError) {
        console.log("Cleanup warning:", cleanupError);
      }
    } catch (error) {
      console.error("Failed to process audio recording:", error);
      Alert.alert("Lỗi", "Không thể xử lý ghi âm. Vui lòng thử lại.");
      recordingRef.current = null;
      setRecording(false);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const uploadAudioRecording = async (uri: string) => {
    try {
      setIsUploading(true);
      setUploadProgress(0);

      const fileName = `audio_${Date.now()}.m4a`;
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        throw new Error("Không tìm thấy token xác thực");
      }

      const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
      const fileSize = fileInfo.exists ? (fileInfo as any).size || 0 : 0;

      const result = await cloudinaryService.uploadFile(
        uri,
        {
          name: fileName,
          type: "audio",
          size: fileSize,
        },
        token,
        (progress) => {
          setUploadProgress(progress);
        }
      );

      if (result && result.fileUrl) {
        await sendMessage(
          "Tin nhắn thoại",
          "audio",
          result.fileUrl,
          fileName,
          fileSize
        );
      }
    } catch (error) {
      console.error("Audio upload error:", error);
      Alert.alert("Lỗi", "Không thể tải lên tin nhắn thoại. Vui lòng thử lại.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

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

  const renderMessage = ({ item }: { item: Message }) => {
    const isCurrentUser = item.sender._id === user._id;
    const messageTime = format(new Date(item.createdAt), "HH:mm");

    return (
      <View
        style={[
          styles.messageContainer,
          isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage,
        ]}
      >
        {!isCurrentUser && (
          <Image
            source={{
              uri: item.sender.avt || "https://via.placeholder.com/40",
            }}
            style={styles.avatar}
          />
        )}

        <View
          style={[
            styles.messageBubble,
            isCurrentUser ? styles.currentUserBubble : styles.otherUserBubble,
            item.failed ? styles.failedMessage : {},
          ]}
        >
          {!isCurrentUser && (
            <Text style={styles.messageSender}>{item.sender.name}</Text>
          )}

          {item.isUnsent ? (
            <Text style={styles.deletedMessage}>
              This message has been deleted
            </Text>
          ) : (
            <>
              {item.type === "image" && item.fileUrl ? (
                <TouchableOpacity
                  onPress={() => handleImagePress(item.fileUrl)}
                >
                  <Image
                    source={{ uri: item.fileUrl }}
                    style={styles.messageImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ) : item.type === "video" && item.fileUrl ? (
                <TouchableOpacity
                  onPress={() => handleVideoPress(item.fileUrl)}
                >
                  <View style={styles.videoThumbnail}>
                    <Video
                      source={{ uri: item.fileUrl }}
                      style={styles.messageVideo}
                      resizeMode={ResizeMode.COVER}
                      shouldPlay={false}
                      isMuted={true}
                    />
                    <View style={styles.playButton}>
                      <Ionicons name="play-circle" size={40} color="#fff" />
                    </View>
                  </View>
                </TouchableOpacity>
              ) : item.type === "audio" && item.fileUrl ? (
                <TouchableOpacity onPress={() => Linking.openURL(item.fileUrl)}>
                  <View style={styles.audioContainer}>
                    <Ionicons name="musical-notes" size={24} color="#0084ff" />
                    <Text style={styles.audioText}>Phát audio</Text>
                  </View>
                </TouchableOpacity>
              ) : item.type === "file" && item.fileUrl ? (
                <TouchableOpacity onPress={() => Linking.openURL(item.fileUrl)}>
                  <View style={styles.fileContainer}>
                    <Ionicons name="document" size={24} color="#0084ff" />
                    <Text style={styles.fileText}>
                      {item.fileName || "Tải file"}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <Text style={styles.messageText}>{item.content}</Text>
              )}

              <Text style={styles.messageTime}>
                {messageTime}
                {item.failed && " (Failed)"}
              </Text>
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={navigateToGroupDetails}
          style={styles.groupInfo}
        >
          <Text style={styles.groupName}>{groupName}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={navigateToGroupDetails}>
          <Ionicons
            name="information-circle-outline"
            size={24}
            color="#0084ff"
          />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0084ff" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item._id || item.tempId}
          contentContainerStyle={styles.messagesList}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No messages yet</Text>
              <Text style={styles.emptySubtext}>
                Be the first to send a message!
              </Text>
            </View>
          }
        />
      )}

      {/* Typing indicator */}
      {Object.values(typingUsers).length > 0 && (
        <View style={styles.typingIndicator}>
          <Text style={styles.typingText}>
            {Object.values(typingUsers).join(", ")}{" "}
            {Object.values(typingUsers).length > 1
              ? "are typing..."
              : "is typing..."}
          </Text>
        </View>
      )}

      {renderUploadProgress()}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setShowAttachMenu(true)}
          >
            <Ionicons name="attach" size={24} color="#0084ff" />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            value={inputMessage}
            onChangeText={handleTyping}
            multiline
          />

          {inputMessage.trim() ? (
            <TouchableOpacity
              style={styles.sendButton}
              onPress={() => sendMessage(inputMessage.trim(), "text")}
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
                color={recording ? "#ff0000" : "#0084ff"}
              />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {renderAttachmentMenu()}

      {/* Thêm ImageViewer */}
      <ImageView
        images={selectedImage ? [{ uri: selectedImage }] : []}
        imageIndex={0}
        visible={isImageViewVisible}
        onRequestClose={() => setIsImageViewVisible(false)}
      />

      {/* Thêm Video Player Modal */}
      {isVideoVisible && selectedVideo && (
        <Modal
          visible={isVideoVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setIsVideoVisible(false)}
        >
          <View style={styles.videoModal}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setIsVideoVisible(false)}
            >
              <Ionicons name="close" size={30} color="#fff" />
            </TouchableOpacity>
            <Video
              source={{ uri: selectedVideo }}
              style={styles.fullScreenVideo}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={true}
            />
          </View>
        </Modal>
      )}
    </SafeAreaView>
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
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    padding: 4,
  },
  groupInfo: {
    flex: 1,
    marginLeft: 10,
  },
  groupName: {
    fontSize: 18,
    fontWeight: "bold",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  messagesList: {
    padding: 16,
  },
  messageContainer: {
    flexDirection: "row",
    marginBottom: 16,
    maxWidth: "80%",
  },
  currentUserMessage: {
    alignSelf: "flex-end",
  },
  otherUserMessage: {
    alignSelf: "flex-start",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 8,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 18,
    maxWidth: "100%",
  },
  currentUserBubble: {
    backgroundColor: "#0084ff",
  },
  otherUserBubble: {
    backgroundColor: "#e4e6eb",
  },
  messageSender: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 4,
    color: "#333",
  },
  messageText: {
    fontSize: 16,
    color: "#000",
  },
  messageTime: {
    fontSize: 10,
    color: "#888",
    alignSelf: "flex-end",
    marginTop: 4,
  },
  deletedMessage: {
    fontSize: 14,
    fontStyle: "italic",
    color: "#888",
  },
  inputContainer: {
    flexDirection: "row",
    padding: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: "#f0f2f5",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: "#0084ff",
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#888",
  },
  emptySubtext: {
    fontSize: 14,
    color: "#888",
    marginTop: 8,
  },
  typingIndicator: {
    backgroundColor: "#f0f2f5",
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  typingText: {
    fontSize: 12,
    color: "#666",
    fontStyle: "italic",
  },
  failedMessage: {
    backgroundColor: "#ffdddd",
    borderWidth: 1,
    borderColor: "#ffaaaa",
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: 10,
  },
  videoThumbnail: {
    width: 200,
    height: 200,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  messageVideo: {
    width: "100%",
    height: "100%",
  },
  playButton: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  videoModal: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullScreenVideo: {
    width: "100%",
    height: 300,
  },
  closeButton: {
    position: "absolute",
    top: 40,
    right: 20,
    zIndex: 1,
  },
  audioContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#f0f2f5",
    borderRadius: 20,
  },
  audioText: {
    marginLeft: 10,
    color: "#0084ff",
  },
  fileContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#f0f2f5",
    borderRadius: 20,
  },
  fileText: {
    marginLeft: 10,
    color: "#0084ff",
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
    backgroundColor: "#0084ff",
  },
  progressText: {
    marginTop: 5,
    textAlign: "center",
    fontSize: 12,
    color: "#666",
  },
  attachButton: {
    padding: 5,
    marginRight: 5,
  },
  recordButton: {
    padding: 5,
    marginLeft: 10,
  },
});

export default GroupChatScreen;
