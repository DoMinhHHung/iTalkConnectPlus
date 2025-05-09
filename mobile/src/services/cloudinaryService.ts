import axios from "axios";
import { CLOUDINARY_CONFIG, getAPIURL, API_URL, POSSIBLE_IPS } from "../config/constants";
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
    console.log("API URL:", `${getAPIURL()}/api/chat/upload-cloudinary`);

    // Phương pháp mới: Upload qua server của bạn
    // Server sẽ xử lý việc upload lên Cloudinary
    const response = await axios.post(
      `${getAPIURL()}/api/chat/upload-cloudinary`,
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
    console.log("Starting image upload with URI:", imageUri.substring(0, 50));
    
    // 1. Get auth token
    const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    
    // 2. Get base API URL 
    const savedApiUrl = await AsyncStorage.getItem(STORAGE_KEYS.API_IP);
    const apiUrl = savedApiUrl || getAPIURL();
    console.log(`Using API URL: ${apiUrl}`);

    // Try converting to base64 and sending that way first (most reliable)
    try {
      console.log("Attempting to upload as base64...");
      const mimeType = imageUri.endsWith(".png") ? "image/png" : "image/jpeg";
      const base64 = await FileSystem.readAsStringAsync(imageUri, { 
        encoding: FileSystem.EncodingType.Base64 
      });
      const formattedBase64 = `data:${mimeType};base64,${base64}`;
      
      // Send as JSON with base64 data
      const response = await axios.post(
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
          timeout: 30000,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress(percentCompleted);
            }
          }
        }
      );
      
      if (response.data && (response.data.url || response.data.file?.fileUrl)) {
        console.log("Base64 upload successful:", response.data.url || response.data.file?.fileUrl);
        return {
          secure_url: response.data.url || response.data.file?.fileUrl,
          bytes: response.data.size || response.data.file?.fileSize || 0,
          format: "jpg",
          original_filename: response.data.file?.fileName || "image.jpg",
        };
      }
    } catch (base64Error) {
      console.log("Base64 upload failed:", base64Error);
      // Continue to FormData method if base64 fails
    }
    
    // Try FormData upload as fallback
    try {
      console.log("Attempting FormData upload...");
      
      // Create form data
      const formData = new FormData();
      const fileName = imageUri.split("/").pop() || "image.jpg";
      const mimeType = imageUri.endsWith(".png") ? "image/png" : "image/jpeg";
      
      formData.append("file", {
        uri: imageUri,
        name: fileName,
        type: mimeType,
      } as any);
      
      const headers: any = {
        "Content-Type": "multipart/form-data",
      };
      
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const response = await axios.post(
        `${apiUrl}/api/chat/upload-cloudinary`,
        formData,
        {
          headers,
          timeout: 30000,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress(percentCompleted);
            }
          }
        }
      );
      
      if (response.data && response.data.file) {
        console.log("FormData upload successful:", response.data.file.fileUrl);
        return {
          secure_url: response.data.file.fileUrl,
          bytes: response.data.file.fileSize || 0,
          format: response.data.file.format || "jpg",
          original_filename: response.data.file.fileName,
        };
      }
    } catch (formDataError) {
      console.log("FormData upload failed:", formDataError);
      // If all direct methods fail, try fallback IPs
    }

    // If all methods fail, try direct Cloudinary upload
    console.log("Attempting direct Cloudinary upload as last resort...");
    try {
      const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
      return await uploadDirectToCloudinary(base64);
    } catch (cloudinaryError) {
      console.error("Direct Cloudinary upload failed:", cloudinaryError);
      throw new Error("All upload methods failed");
    }
  } catch (error) {
    console.error("Error in uploadImage:", error);
    throw error;
  }
};

/**
 * Uploads a file to the server using Cloudinary
 * @param fileUri The local URI of the file to upload
 * @param fileInfo File information object
 * @param token Authentication token
 * @param onProgress Optional callback for upload progress
 * @returns Promise with the uploaded file data
 */
export const uploadFile = async (
  fileUri: string,
  fileInfo: {
    type: string;
    name: string;
    size: number;
  },
  token: string,
  onProgress?: (progress: number) => void
): Promise<any> => {
  try {
    console.log("Starting file upload with URI:", fileUri);
    console.log("File info:", fileInfo);
    
    // For videos and large files, use a more reliable upload approach
    const isVideo = fileInfo.type.includes('video') || 
                   (fileInfo.name && fileInfo.name.match(/\.(mp4|mov|avi|wmv|flv|mkv)$/i));
    const isLargeFile = fileInfo.size > 5 * 1024 * 1024; // 5MB threshold
    
    if (isVideo || isLargeFile) {
      console.log(`Processing ${isVideo ? 'video' : 'large'} file (${Math.round(fileInfo.size/1024/1024)}MB)...`);
      return await uploadLargeFile(fileUri, fileInfo, token, onProgress);
    }

    // Try using the standard FormData approach for smaller files
    try {
      // Create form data for the file
      const formData = new FormData();
      formData.append("file", {
        uri: fileUri,
        name: fileInfo.name || "file.jpg",
        type: getMimeType(fileInfo.type),
      } as any);

      console.log("Uploading with FormData to:", `${getAPIURL()}/api/chat/upload-cloudinary`);
      
      // Upload with standard axios
      const response = await axios.post(
        `${getAPIURL()}/api/chat/upload-cloudinary`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${token}`,
          },
          timeout: 30000,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress(percentCompleted);
            }
          },
        }
      );

      console.log("Upload response:", response.data);
      return response.data.file;
    } catch (formDataError) {
      console.error("FormData upload failed:", formDataError);
      // Fallback to Expo FileSystem upload
    }

    // Fallback: Use Expo's FileSystem uploadAsync
    console.log("Falling back to FileSystem.uploadAsync");
    const uploadOptions: FileSystem.FileSystemUploadOptions = {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "multipart/form-data",
      },
      parameters: {
        filename: fileInfo.name || "file.jpg",
      },
    };

    // Upload with progress tracking
    const response = await FileSystem.uploadAsync(
      `${getAPIURL()}/api/chat/upload-cloudinary`,
      fileUri,
      uploadOptions
    );

    console.log("FileSystem upload response status:", response.status);
    
    if (response.status !== 200) {
      const error = response.body ? JSON.parse(response.body) : { message: "Unknown error" };
      throw new Error(error.message || "Upload failed");
    }

    const responseData = JSON.parse(response.body);
    console.log("FileSystem upload successful:", responseData);
    return responseData.file;
  } catch (error) {
    console.error("Error in cloudinaryService.uploadFile:", error);
    throw error;
  }
};

/**
 * Specialized function for uploading large files like videos
 * Uses a more reliable approach with proper timeouts and error handling
 */
const uploadLargeFile = async (
  fileUri: string,
  fileInfo: {
    type: string;
    name: string;
    size: number;
  },
  token: string,
  onProgress?: (progress: number) => void
): Promise<any> => {
  try {
    console.log("Starting large file upload process...");
    
    // Determine if it's a video and file size - use this for adjusting settings
    const isVideo = fileInfo.type.includes('video') || 
                   (fileInfo.name && fileInfo.name.match(/\.(mp4|mov|avi|wmv|flv|mkv)$/i));
    const fileSizeMB = Math.round(fileInfo.size/1024/1024);
    
    // Adjust timeout based on file size - give more time for larger files
    // 2 minutes base + 30 seconds per MB, with max of 10 minutes
    const timeoutBase = 2 * 60 * 1000; // 2 minutes base
    const timeoutPerMB = 30 * 1000; // 30 seconds per MB
    const maxTimeout = 10 * 60 * 1000; // Max 10 minutes
    const calculatedTimeout = Math.min(timeoutBase + (fileSizeMB * timeoutPerMB), maxTimeout);
    
    console.log(`Setting timeout to ${calculatedTimeout/1000} seconds for ${fileSizeMB}MB ${isVideo ? 'video' : 'file'}`);
    
    // Use FormData with special configuration for large files
    const formData = new FormData();
    formData.append("file", {
      uri: fileUri,
      name: fileInfo.name || (isVideo ? "video.mp4" : "file"),
      type: getMimeType(fileInfo.type || (isVideo ? "video" : "file")),
    } as any);

    // Add metadata to help server process the file correctly
    formData.append("fileSize", fileInfo.size.toString());
    formData.append("fileType", isVideo ? "video" : fileInfo.type);
    formData.append("isLargeFile", "true");
    
    // For videos, request chunked upload explicitly
    if (isVideo) {
      formData.append("useChunkedUpload", "true");
      formData.append("chunkSize", "6000000"); // 6MB chunks
    }
    
    // CRITICAL FIX: Get API URL properly as it returns a Promise
    const apiUrl = await getAPIURL();
    // Log the upload attempt with properly resolved URL
    console.log(`Uploading large file to ${apiUrl}/api/chat/upload-cloudinary with ${calculatedTimeout}ms timeout`);
    
    // Add fallback URLs in case the primary one fails
    const fallbackUrls = POSSIBLE_IPS.map(ip => `http://${ip}:3005`);
    
    // Implement retry mechanism with fallback URLs
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = null;
    let currentApiUrl = apiUrl;
    
    while (attempts < maxAttempts) {
      attempts++;
      try {
        console.log(`Upload attempt ${attempts}/${maxAttempts} to ${currentApiUrl}/api/chat/upload-cloudinary`);
        
        // Reset progress for new attempts
        if (attempts > 1 && onProgress) {
          onProgress(0);
        }
        
        // Calculate timeout for this attempt (increase with each retry)
        const attemptTimeout = calculatedTimeout * (1 + (attempts - 1) * 0.5);
        console.log(`Using timeout of ${Math.round(attemptTimeout/1000)} seconds for attempt ${attempts}`);
        
        const response = await axios.post(
          `${currentApiUrl}/api/chat/upload-cloudinary`,
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
              "Authorization": `Bearer ${token}`,
              "Connection": "keep-alive",
            },
            timeout: attemptTimeout,
            maxContentLength: 100 * 1024 * 1024,
            maxBodyLength: 100 * 1024 * 1024,
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total && onProgress) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                onProgress(percentCompleted);
                if (percentCompleted % 10 === 0) {
                  console.log(`Upload progress: ${percentCompleted}%`);
                }
              }
            },
          }
        );

        console.log(`Attempt ${attempts} successful:`, response.status);
        return response.data.file;
      } catch (error: any) {
        lastError = error;
        console.error(`Attempt ${attempts} failed:`, error.message);
        
        // Check if this error is retryable
        const isNetworkError = !error.response && error.message && (
          error.message.includes('timeout') || 
          error.message.includes('network') ||
          error.code === 'ECONNABORTED'
        );
        
        const isServerError = error.response && error.response.status >= 500;
        
        if ((isNetworkError || isServerError) && attempts < maxAttempts) {
          // Before next attempt, try a different API URL if available
          if (fallbackUrls.length > 0 && attempts <= fallbackUrls.length) {
            // Pick a fallback URL different from current
            const fallbackIndex = attempts - 1;
            if (fallbackIndex < fallbackUrls.length && fallbackUrls[fallbackIndex] !== currentApiUrl) {
              currentApiUrl = fallbackUrls[fallbackIndex];
              console.log(`Switching to fallback URL: ${currentApiUrl}`);
            }
          }
          
          const delayMs = 2000 * attempts; // Increasing delay between attempts
          console.log(`Retryable error detected. Waiting ${delayMs}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          // Continue to next attempt
        } else {
          // Non-retryable error or max attempts reached
          break;
        }
      }
    }
    
    // If we get here, all attempts failed
    console.error(`All ${maxAttempts} upload attempts failed.`);
    
    // As a last resort for videos, try alternative approach based on file size
    if (isVideo && fileSizeMB > 5) {
      console.log("Trying alternative approach for large video...");
      return await tryAlternativeVideoUpload(fileUri, fileInfo, token, onProgress);
    }
    
    // Provide detailed error information
    if (lastError) {
      if (lastError.response) {
        console.error("Server responded with:", {
          status: lastError.response.status,
          data: lastError.response.data
        });
        throw new Error(`Server error ${lastError.response.status}: ${JSON.stringify(lastError.response.data)}`);
      } else if (lastError.request) {
        console.error("No response received from server");
        throw new Error(`Upload failed after ${maxAttempts} attempts. Check your internet connection and try again with a smaller file or better connection.`);
      } else {
        throw lastError;
      }
    } else {
      throw new Error("Upload failed with unknown error");
    }
  } catch (error: any) {
    console.error("Large file upload failed:", error.message);
    throw error;
  }
};

/**
 * Alternative approach for uploading videos when primary method fails
 * Uses direct Cloudinary upload with different parameters
 */
const tryAlternativeVideoUpload = async (
  fileUri: string,
  fileInfo: {
    type: string;
    name: string;
    size: number;
  },
  token: string,
  onProgress?: (progress: number) => void
): Promise<any> => {
  try {
    console.log("Using alternative chunked upload method for video...");
    onProgress && onProgress(0);
    
    // Thay vì dùng upload trực tiếp, hãy thử tách video thành các đoạn nhỏ và upload từng phần
    // Đây là video, nên chúng ta chỉ gửi thông tin đến server và để server xử lý
    
    // Lấy API URL đúng cách
    const apiUrl = await getAPIURL();
    console.log(`Using alternative upload URL: ${apiUrl}/api/chat/video-upload`);
    
    // Tạo form data với thông tin để server có thể xử lý đặc biệt cho video
    const formData = new FormData();
    formData.append("file", {
      uri: fileUri,
      name: fileInfo.name || "video.mp4",
      type: getMimeType(fileInfo.type || "video"),
    } as any);
    
    // Thêm metadata cho server
    formData.append("useAlternativeMethod", "true");
    formData.append("fileType", "video");
    formData.append("fileSize", fileInfo.size.toString());
    
    // Tạo request
    const response = await axios.post(
      `${apiUrl}/api/chat/upload-cloudinary`, // Dùng cùng endpoint
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
          "Authorization": `Bearer ${token}`,
          "Connection": "keep-alive",
          "X-Alternative-Method": "true", // Thêm header để server biết đây là phương pháp thay thế
        },
        timeout: 5 * 60 * 1000, // 5 phút
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total && onProgress) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(percentCompleted);
            console.log(`Alternative upload progress: ${percentCompleted}%`);
          }
        },
      }
    );
    
    console.log("Alternative upload method successful:", response.status);
    
    if (response.data && response.data.file) {
      return response.data.file;
    } else {
      console.error("Server response missing file data:", response.data);
      throw new Error("Server response missing file data");
    }
  } catch (firstError) {
    console.error("Alternative method also failed:", firstError);
    
    // Thử một endpoint khác nếu có thể - endpoing dự phòng
    try {
      console.log("Trying backup endpoint for video upload...");
      onProgress && onProgress(0);
      
      // Lấy API URL đúng cách
      const apiUrl = await getAPIURL();
      
      // Tạo FormData
      const formData = new FormData();
      formData.append("file", {
        uri: fileUri,
        name: fileInfo.name || "video.mp4",
        type: getMimeType(fileInfo.type || "video"),
      } as any);
      
      // Thêm metadata
      formData.append("fileType", "video");
      formData.append("fileSize", fileInfo.size.toString());
      formData.append("isEmergencyUpload", "true");
      
      // Thử với endpoint test-cloudinary-upload (không cần auth) nếu có
      const response = await axios.post(
        `${apiUrl}/api/chat/test-cloudinary-upload`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          timeout: 5 * 60 * 1000,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              onProgress(percentCompleted);
              console.log(`Backup upload progress: ${percentCompleted}%`);
            }
          },
        }
      );
      
      console.log("Backup upload successful:", response.status);
      
      if (response.data && response.data.file) {
        return response.data.file;
      } else if (response.data && response.data.url) {
        // Format để phù hợp với cấu trúc dữ liệu mong đợi
        return {
          fileId: response.data.public_id || "unknown_id",
          fileUrl: response.data.url,
          fileName: fileInfo.name || "video.mp4",
          fileSize: fileInfo.size,
          fileType: "video",
        };
      } else {
        console.error("Backup response missing file data:", response.data);
        throw new Error("Backup response missing file data");
      }
    } catch (backupError) {
      console.error("All alternative methods failed:", backupError);
      throw new Error("Tất cả phương pháp tải lên video đều thất bại. Vui lòng thử video có kích thước nhỏ hơn hoặc kiểm tra kết nối.");
    }
  }
};

/**
 * Gets the MIME type based on file type
 */
const getMimeType = (type: string): string => {
  switch (type) {
    case "image":
      return "image/jpeg";
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/mpeg";
    case "pdf":
      return "application/pdf";
    case "doc":
    case "docx":
      return "application/msword";
    default:
      return "application/octet-stream";
  }
};

/**
 * Gets asset information including file size
 */
export const getAssetInfo = async (
  uri: string
): Promise<FileSystem.FileInfo> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
    return fileInfo;
  } catch (error) {
    console.error("Error getting asset info:", error);
    throw error;
  }
};

/**
 * Optimizes an image before upload by resizing and compressing
 */
export const optimizeImage = async (
  uri: string,
  maxWidth = 1200,
  quality = 0.8
): Promise<string> => {
  try {
    // For full implementation, you'd need to use a library like expo-image-manipulator
    // This is a placeholder for the concept
    // const manipulateResult = await ImageManipulator.manipulateAsync(
    //   uri,
    //   [{ resize: { width: maxWidth } }],
    //   { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
    // );
    // return manipulateResult.uri;
    
    // For now, just return the original URI
    return uri;
  } catch (error) {
    console.error("Error optimizing image:", error);
    return uri; // Return original if optimization fails
  }
};
