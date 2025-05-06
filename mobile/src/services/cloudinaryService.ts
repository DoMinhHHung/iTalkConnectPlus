import axios from "axios";
import { CLOUDINARY_CONFIG, API_URL, POSSIBLE_IPS } from "../config/constants";
import * as FileSystem from 'expo-file-system';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_KEYS } from "../config/constants";

/**
 * Dịch vụ upload ảnh lên Cloudinary với nhiều phương thức dự phòng
 */

/**
 * Upload ảnh lên Cloudinary qua server proxy để bảo mật API key/secret
 * @param base64Image Chuỗi base64 của ảnh
 * @returns URL của ảnh sau khi upload
 */
export const uploadImageToCloudinary = async (
  base64Image: string
): Promise<string> => {
  try {
    // Kiểm tra nếu image đã có prefix, nếu không thì thêm vào
    const formattedBase64 = base64Image.startsWith("data:")
      ? base64Image
      : `data:image/jpeg;base64,${base64Image}`;

    console.log("Uploading image to server for Cloudinary processing...");
    console.log("API URL:", `${API_URL}/api/chat/upload-cloudinary`);

    // Phương pháp mới: Upload qua server của bạn
    // Server sẽ xử lý việc upload lên Cloudinary
    const response = await axios.post(
      `${API_URL}/api/chat/upload-cloudinary`,
      {
        image: formattedBase64,
        folder: CLOUDINARY_CONFIG.FOLDER,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 15000, // 15 second timeout
      }
    );

    console.log("Server upload response status:", response.status);
    console.log("Server upload response data:", response.data);

    if (response.data && response.data.url) {
      return response.data.url;
    } else {
      throw new Error("No image URL returned from server");
    }
  } catch (error) {
    console.error("Error uploading image to server:", error);

    // Fallback: Upload trực tiếp lên Cloudinary nếu server không phản hồi
    return uploadDirectToCloudinary(base64Image);
  }
};

/**
 * Fallback method: Upload trực tiếp lên Cloudinary
 */
const uploadDirectToCloudinary = async (
  base64Image: string
): Promise<string> => {
  try {
    // Kiểm tra nếu image đã có prefix
    const formattedBase64 = base64Image.startsWith("data:")
      ? base64Image
      : `data:image/jpeg;base64,${base64Image}`;

    console.log("Attempting direct upload to Cloudinary...");
    console.log("Cloudinary config:", {
      cloud_name: CLOUDINARY_CONFIG.CLOUD_NAME,
      upload_preset: CLOUDINARY_CONFIG.UPLOAD_PRESET,
      folder: CLOUDINARY_CONFIG.FOLDER,
    });

    // Tạo FormData
    const formData = new FormData();
    formData.append("file", formattedBase64);
    formData.append("upload_preset", CLOUDINARY_CONFIG.UPLOAD_PRESET);
    formData.append("folder", CLOUDINARY_CONFIG.FOLDER);

    // Upload endpoint
    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.CLOUD_NAME}/image/upload`;
    console.log("Cloudinary URL:", cloudinaryUrl);

    const response = await axios.post(cloudinaryUrl, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      timeout: 15000, // 15 second timeout
    });

    console.log("Direct Cloudinary upload response status:", response.status);
    console.log("Direct Cloudinary upload response data:", response.data);

    return response.data.secure_url;
  } catch (error) {
    console.error(
      "Direct Cloudinary upload failed:",
      error.response?.data || error.message
    );
    throw new Error("Failed to upload image to Cloudinary");
  }
};

/**
 * Upload ảnh lên server, nếu thất bại thì thử với các địa chỉ server khác nhau
 * @param imageUri URI của ảnh
 * @param onProgress Callback để cập nhật tiến độ upload
 * @returns Thông tin file đã upload
 */
export const uploadImage = async (
  imageUri: string,
  type: string = "chat_image",
  onProgress?: (progress: number) => void
): Promise<any> => {
  try {
    // 1. Thử lấy URL API từ storage
    const savedApiUrl = await AsyncStorage.getItem(STORAGE_KEYS.API_IP);
    const apiUrl = savedApiUrl || API_URL;
    
    console.log(`Thử upload với URL từ storage: ${apiUrl}`);

    // 2. Tạo formData
    const formData = new FormData();
    const fileName = imageUri.split("/").pop() || "image.jpg";
    const mimeType = imageUri.endsWith(".png") ? "image/png" : "image/jpeg";
    
    formData.append("file", {
      uri: imageUri,
      name: fileName,
      type: mimeType,
    } as any);
    formData.append("type", "image");
    
    // 3. Thử với token
    const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    const headers: any = {
      "Content-Type": "multipart/form-data",
    };
    
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // 4. Chuyển đổi ảnh sang base64 và thử upload qua Cloudinary trực tiếp
    try {
      console.log("Thử upload qua Cloudinary trước...");
      const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
      const formattedBase64 = `data:${mimeType};base64,${base64}`;
      
      const cloudinaryResponse = await axios.post(
        `${apiUrl}/api/chat/upload-cloudinary`,
        {
          image: formattedBase64,
          folder: CLOUDINARY_CONFIG.FOLDER
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          timeout: 10000,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress(percentCompleted);
            }
          }
        }
      );
      
      if (cloudinaryResponse.data && cloudinaryResponse.data.url) {
        console.log("Upload qua Cloudinary thành công:", cloudinaryResponse.data.url);
        return {
          secure_url: cloudinaryResponse.data.url,
          bytes: cloudinaryResponse.data.size?.optimized * 1024 || 0,
          format: "jpg",
          original_filename: fileName,
        };
      }
    } catch (cloudinaryError) {
      console.log("Lỗi khi upload qua Cloudinary:", cloudinaryError);
      // Không throw lỗi, tiếp tục thử phương pháp khác
    }

    // 5. Thử upload trực tiếp lên Cloudinary (không qua server)
    try {
      console.log("Thử upload trực tiếp lên Cloudinary...");
      const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
      
      // Tạo FormData mới
      const cloudinaryFormData = new FormData();
      cloudinaryFormData.append("file", `data:${mimeType};base64,${base64}`);
      cloudinaryFormData.append("upload_preset", CLOUDINARY_CONFIG.UPLOAD_PRESET);
      cloudinaryFormData.append("folder", CLOUDINARY_CONFIG.FOLDER);
      
      const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.CLOUD_NAME}/image/upload`;
      
      const directResponse = await axios.post(cloudinaryUrl, cloudinaryFormData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 15000,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total && onProgress) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(percentCompleted);
          }
        }
      });
      
      if (directResponse.data && directResponse.data.secure_url) {
        console.log("Upload trực tiếp lên Cloudinary thành công:", directResponse.data.secure_url);
        return directResponse.data;
      }
    } catch (directCloudinaryError) {
      console.log("Lỗi khi upload trực tiếp lên Cloudinary:", directCloudinaryError);
      // Không throw lỗi, tiếp tục thử phương pháp khác
    }

    // 6. Thử upload qua server với endpoint /api/chat/upload
    try {
      console.log(`Thử upload qua API ${apiUrl}/api/chat/upload...`);
      const response = await axios.post(
        `${apiUrl}/api/chat/upload`,
        formData,
        {
          headers,
          timeout: 15000,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress(percentCompleted);
            }
          }
        }
      );

      if (response.data && response.data.fileUrl) {
        console.log("Upload qua API thành công:", response.data.fileUrl);
        return {
          secure_url: response.data.fileUrl,
          bytes: response.data.fileSize || 0,
          format: response.data.fileMimeType?.split('/')[1] || "jpg",
          original_filename: response.data.fileName,
        };
      }
    } catch (apiError) {
      console.log("Lỗi khi upload qua API chính:", apiError);
      // Không throw lỗi, tiếp tục thử với các API thay thế
    }

    // 7. Thử với tất cả các địa chỉ IP có thể
    for (let i = 0; i < POSSIBLE_IPS.length; i++) {
      try {
        const alternativeUrl = `http://${POSSIBLE_IPS[i]}:3005`;
        console.log(`Thử upload với URL thay thế: ${alternativeUrl}/api/chat/upload`);
        
        const altResponse = await axios.post(
          `${alternativeUrl}/api/chat/upload`,
          formData,
          {
            headers,
            timeout: 10000,
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total && onProgress) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                onProgress(percentCompleted);
              }
            }
          }
        );
        
        if (altResponse.data && altResponse.data.fileUrl) {
          console.log("Upload thành công với URL thay thế:", altResponse.data.fileUrl);
          
          // Lưu URL thành công để sử dụng sau này
          await AsyncStorage.setItem(STORAGE_KEYS.API_IP, alternativeUrl);
          
          return {
            secure_url: altResponse.data.fileUrl,
            bytes: altResponse.data.fileSize || 0,
            format: altResponse.data.fileMimeType?.split('/')[1] || "jpg",
            original_filename: altResponse.data.fileName,
          };
        }
      } catch (altError) {
        console.log(`Lỗi khi thử với API thay thế ${i+1}:`, altError);
        // Tiếp tục vòng lặp để thử API tiếp theo
      }
    }
    
    // Nếu tất cả các phương pháp đều thất bại, throw lỗi
    throw new Error("Không thể upload ảnh qua bất kỳ phương pháp nào");
  } catch (error) {
    console.error("Lỗi trong quá trình upload:", error);
    throw error;
  }
};
