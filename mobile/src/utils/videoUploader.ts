import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../config/constants';
import { uploadFile } from '../services/cloudinaryService';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import { getAPIURL } from '../config/constants';

/**
 * Chọn video có giới hạn thời lượng và hỗ trợ chỉnh sửa
 * Này tốt hơn cách chọn video thông thường
 */
export const pickOptimizedVideo = async () => {
  try {
    // Kiểm tra quyền truy cập
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert("Cần cấp quyền", "Bạn cần cấp quyền truy cập vào thư viện ảnh để chọn video.");
      return null;
    }

    // Mở chọn video với các tùy chọn tối ưu
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: true, // Cho phép cắt video
      quality: 0.7, // Giảm chất lượng để giảm kích thước
      videoMaxDuration: 60, // Giới hạn 60 giây
      // Chất lượng video phụ thuộc vào nền tảng
      videoQuality: Platform.OS === 'ios' 
        ? ImagePicker.UIImagePickerControllerQualityType.Medium 
        : ImagePicker.UIImagePickerControllerQualityType.Medium,
    });

    if (result.canceled) {
      return null;
    }

    // Trả về video đã chọn
    return result.assets[0];
  } catch (error) {
    console.error("Lỗi khi chọn video:", error);
    Alert.alert("Lỗi", "Không thể chọn video. Vui lòng thử lại.");
    return null;
  }
};

/**
 * Utility để xử lý tải lên video với các tính năng cải tiến:
 * - Kiểm tra kích thước tệp
 * - Xử lý lỗi thông minh
 * - Theo dõi tiến trình
 * - Tự động thử lại khi gặp lỗi
 */

// Chuẩn bị video để tải lên, trả về thông tin cần thiết
export const prepareVideoForUpload = async (videoUri: string) => {
  try {
    // Lấy thông tin file
    const fileInfo = await FileSystem.getInfoAsync(videoUri, { size: true });
    if (!fileInfo.exists) {
      throw new Error("Video không tồn tại");
    }

    // Lấy tên tệp từ URI
    const fileName = videoUri.split('/').pop() || `video_${Date.now()}.mp4`;
    
    // Tính kích thước đơn vị MB
    const fileSizeMB = fileInfo.size / 1024 / 1024;
    
    return {
      uri: videoUri,
      name: fileName,
      size: fileInfo.size,
      sizeFormatted: `${fileSizeMB.toFixed(2)} MB`,
      exists: fileInfo.exists,
      mimeType: 'video/mp4',
    };
  } catch (error) {
    console.error("Lỗi chuẩn bị video:", error);
    throw new Error(`Không thể chuẩn bị video: ${error.message}`);
  }
};

// Tải video lên máy chủ
export const uploadVideo = async (
  videoUri: string,
  onProgress?: (progress: number) => void,
  onBeforeUpload?: (fileInfo: any) => Promise<boolean>
) => {
  try {
    // Chuẩn bị video
    const videoInfo = await prepareVideoForUpload(videoUri);
    console.log("Thông tin video chuẩn bị tải lên:", videoInfo);
    
    // Kiểm tra kích thước
    const fileSizeMB = videoInfo.size / 1024 / 1024;
    if (fileSizeMB > 50) { // Giới hạn 50MB
      throw new Error(`Video quá lớn (${fileSizeMB.toFixed(2)}MB). Vui lòng chọn video nhỏ hơn 50MB.`);
    }
    
    // Nếu có callback trước khi tải lên, gọi nó và kiểm tra kết quả
    if (onBeforeUpload) {
      const shouldContinue = await onBeforeUpload(videoInfo);
      if (!shouldContinue) {
        return null; // Người dùng hủy
      }
    }
    
    // Lấy token xác thực
    const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (!token) {
      throw new Error("Không có token xác thực, vui lòng đăng nhập lại");
    }
    
    // Bắt đầu quá trình tải lên
    console.log(`Bắt đầu tải video lên: ${videoInfo.uri.substring(0, 30)}... (${fileSizeMB.toFixed(2)}MB)`);
    
    try {
      // Gọi hàm tải lên từ cloudinaryService
      const result = await uploadFile(
        videoInfo.uri,
        {
          name: videoInfo.name,
          type: 'video/mp4',
          size: videoInfo.size
        },
        token,
        onProgress
      );
      
      // Kiểm tra kết quả
      if (!result || !result.fileUrl) {
        throw new Error("Tải lên không thành công: Không nhận được URL video");
      }
      
      console.log("Tải video lên thành công:", result.fileUrl);
      
      // Trả về thông tin đã tải lên
      return {
        ...result,
        originalFile: videoInfo
      };
    } catch (error) {
      console.error("Lỗi tải video theo cách thông thường:", error);
      
      // Khi lỗi xảy ra, thử phương pháp dự phòng
      console.log("Thử phương pháp dự phòng không xác thực...");
      
      // Tải lên thông qua endpoint test không cần xác thực
      const apiUrl = await getAPIURL();
      const formData = new FormData();
      formData.append("file", {
        uri: videoInfo.uri,
        name: videoInfo.name,
        type: 'video/mp4',
      } as any);
      
      const response = await axios.post(
        `${apiUrl}/api/chat/test-cloudinary-upload`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          timeout: 5 * 60 * 1000, // 5 phút
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress(percentCompleted);
            }
          },
        }
      );
      
      if (response.data && (response.data.file || response.data.url)) {
        const fileData = response.data.file || {
          fileUrl: response.data.url || response.data.secure_url,
          fileName: videoInfo.name,
          fileSize: videoInfo.size,
          fileType: "video",
        };
        
        return {
          ...fileData,
          originalFile: videoInfo
        };
      }
      
      throw new Error("Tất cả phương pháp tải lên đều thất bại");
    }
  } catch (error) {
    console.error("Lỗi tải video lên:", error);
    throw error;
  }
};

// Hàm kiểm tra và tải lên video với xác nhận người dùng cho video lớn
export const uploadVideoWithConfirmation = async (
  videoUri: string,
  onProgress?: (progress: number) => void
) => {
  try {
    // Chuẩn bị video
    const videoInfo = await prepareVideoForUpload(videoUri);
    const fileSizeMB = videoInfo.size / 1024 / 1024;
    
    // Nếu video lớn, yêu cầu xác nhận
    if (fileSizeMB > 20) { // 20MB trở lên yêu cầu xác nhận
      return new Promise((resolve, reject) => {
        Alert.alert(
          "Video kích thước lớn",
          `Video này có kích thước ${fileSizeMB.toFixed(2)}MB và có thể mất thời gian tải lên. Bạn có muốn tiếp tục?`,
          [
            {
              text: "Hủy",
              style: "cancel",
              onPress: () => resolve(null)
            },
            {
              text: "Tải lên",
              onPress: async () => {
                try {
                  const result = await uploadVideo(videoUri, onProgress);
                  resolve(result);
                } catch (error) {
                  reject(error);
                }
              }
            }
          ]
        );
      });
    }
    
    // Với video nhỏ, tải lên trực tiếp
    return await uploadVideo(videoUri, onProgress);
  } catch (error) {
    console.error("Lỗi trong quá trình tải video:", error);
    throw error;
  }
}; 