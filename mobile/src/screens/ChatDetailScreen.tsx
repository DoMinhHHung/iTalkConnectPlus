import React, { useState } from 'react';
import { Alert, Image, ImagePicker, Toast } from 'react-native';
import { useAsyncStorage } from '@react-native-async-storage/async-storage';
import { useSocket } from '../contexts/SocketContext';
import { useMessages } from '../contexts/MessagesContext';
import { useUser } from '../contexts/UserContext';
import { useFileSystem } from '../contexts/FileSystemContext';
import { useUpload } from '../contexts/UploadContext';
import { Message } from '../types/Message';
import { STORAGE_KEYS } from '../constants/StorageKeys';

const ChatDetailScreen: React.FC = () => {
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const socket = useSocket();
  const messages = useMessages();
  const user = useUser();
  const fileSystem = useFileSystem();
  const upload = useUpload();

  const handleVideoPicker = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert("Cần cấp quyền", "Bạn cần cấp quyền truy cập vào thư viện ảnh để chọn video.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.7,
        videoMaxDuration: 60, // Giới hạn video dưới 60 giây để tránh file quá lớn
        allowsEditing: true,
      });

      if (result.canceled) return;

      const selectedAsset = result.assets[0];
      const uri = selectedAsset.uri;
      
      // Hiển thị thông tin kích thước file và cảnh báo
      const fileInfo = await fileSystem.getInfoAsync(uri, { size: true });
      const fileSizeMB = fileInfo.size ? (fileInfo.size / 1024 / 1024).toFixed(2) : "unknown";
      
      console.log(`Uploading video: ${uri.substring(0, 50)}..., size: ${fileSizeMB}MB`);
      
      // Cảnh báo nếu file quá lớn
      if (fileInfo.size && fileInfo.size > 20 * 1024 * 1024) {
        Alert.alert(
          "Video quá lớn",
          `Video có kích thước ${fileSizeMB}MB có thể mất thời gian tải lên. Bạn có muốn tiếp tục?`,
          [
            { text: "Hủy", style: "cancel" },
            { 
              text: "Tiếp tục", 
              onPress: () => uploadVideoFile(uri, selectedAsset.fileName || "video.mp4", fileInfo.size || 0) 
            }
          ]
        );
      } else {
        // Upload trực tiếp nếu kích thước hợp lý
        await uploadVideoFile(uri, selectedAsset.fileName || "video.mp4", fileInfo.size || 0);
      }
    } catch (error) {
      console.error("Lỗi khi chọn video:", error);
      Alert.alert("Lỗi", "Không thể chọn video. Vui lòng thử lại.");
    }
  };

  const uploadVideoFile = async (uri: string, fileName: string, fileSize: number) => {
    try {
      setUploadingMedia(true);
      setUploadProgress(0);
      
      const token = await useAsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || "";
      
      // Thông báo khi bắt đầu tải lên
      Toast.show({
        type: "info",
        text1: "Đang tải video lên",
        text2: "Quá trình này có thể mất vài phút tùy thuộc vào kích thước video.",
        visibilityTime: 4000,
      });
      
      console.log(`Bắt đầu tải lên video: ${fileName}, kích thước: ${(fileSize/1024/1024).toFixed(2)}MB`);
      
      // Tạo ID tạm thời cho tin nhắn
      const tempId = `temp_${Date.now()}`;
      
      // Thêm tin nhắn tạm thời với trạng thái "đang gửi"
      const tempMessage: Message = {
        _id: tempId,
        sender: {
          _id: user._id,
          name: user.name,
          avt: user.avt,
        },
        content: "Đang tải video...",
        type: "video",
        createdAt: new Date().toISOString(),
        sending: true,
        tempId,
      };
      
      useMessages.setState((prev) => [tempMessage, ...prev]);
      
      // Upload video sử dụng service
      const result = await upload.uploadFile(
        uri,
        {
          type: "video/mp4",
          name: fileName,
          size: fileSize,
        },
        token,
        (progress) => {
          setUploadProgress(progress);
        }
      );
      
      console.log("Kết quả tải lên video:", result);
      
      if (!result || !result.fileUrl) {
        throw new Error("Không nhận được URL video sau khi tải lên");
      }
      
      // Gửi tin nhắn video thực tế
      const videoMessage = {
        receiver: otherUserId,
        sender: user._id,
        content: fileName,
        type: "video",
        fileUrl: result.fileUrl,
        fileName: fileName,
        fileSize: fileSize,
        tempId, // Quan trọng: Gắn tempId để client có thể cập nhật tin nhắn tạm thời
      };
      
      if (isGroup) {
        // Gửi tin nhắn nhóm
        socket.emit("sendGroupMessage", {
          senderId: user._id,
          groupId: chatId,
          content: fileName,
          type: "video",
          tempId,
          fileUrl: result.fileUrl,
          fileName: fileName,
          fileSize: fileSize,
          fileThumbnail: result.fileThumbnail || null,
        });
      } else {
        // Gửi tin nhắn cá nhân
        socket.emit("sendMessage", {
          sender: user._id,
          receiver: otherUserId,
          content: fileName,
          type: "video",
          tempId,
          fileUrl: result.fileUrl,
          fileName: fileName,
          fileSize: fileSize,
          fileThumbnail: result.fileThumbnail || null,
        });
      }
      
      // Thông báo thành công
      Toast.show({
        type: "success",
        text1: "Video đã được gửi",
        visibilityTime: 2000,
      });
      
    } catch (error) {
      console.error("Lỗi tải lên video:", error);
      
      // Xóa tin nhắn tạm nếu có lỗi
      useMessages.setState((prev) => prev.filter((m) => m.tempId !== `temp_${Date.now()}`));
      
      // Thông báo lỗi
      Toast.show({
        type: "error",
        text1: "Lỗi khi tải video",
        text2: error.message || "Vui lòng thử lại với video nhỏ hơn hoặc kiểm tra kết nối mạng.",
        visibilityTime: 4000,
      });
    } finally {
      setUploadingMedia(false);
      setUploadProgress(0);
    }
  };

  return (
    // Rest of the component code remains unchanged
  );
};

export default ChatDetailScreen; 