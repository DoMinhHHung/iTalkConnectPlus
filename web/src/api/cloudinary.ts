import axios from "axios";

/**
 * Compress an image to reduce file size before uploading
 * @param base64Image Base64 string of the image
 * @param maxWidth Maximum width of the compressed image
 * @returns Compressed image as base64 string
 */
const compressImage = (
  base64Image: string,
  maxWidth: number = 800
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      // Create an image element to load the base64 image
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions while maintaining aspect ratio
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          const ratio = maxWidth / width;
          width = maxWidth;
          height = height * ratio;
        }

        // Create a canvas to draw the resized image
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        // Draw the image on the canvas
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Convert to base64 with reduced quality
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);
        resolve(compressedBase64);
      };

      img.onerror = () => {
        reject(new Error("Failed to load image for compression"));
      };

      img.src = base64Image;
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Upload an image to Cloudinary via the server endpoint
 * @param base64Image Base64 representation of the image
 * @param folder Optional folder name in Cloudinary
 * @returns The Cloudinary URL of the uploaded image
 */
export const uploadImageToCloudinary = async (
  base64Image: string,
  folder: string = "italk_app"
): Promise<string> => {
  try {
    // Ensure image has the proper data URL prefix
    const formattedBase64 = base64Image.startsWith("data:")
      ? base64Image
      : `data:image/jpeg;base64,${base64Image}`;

    // Compress the image before uploading
    console.log("Compressing image before upload...");
    const compressedImage = await compressImage(formattedBase64);
    console.log("Image compression completed");

    console.log("Uploading compressed image to Cloudinary via server...");

    const token = localStorage.getItem("token");
    if (!token) throw new Error("Authentication token not found");

    // Use the existing server endpoint for Cloudinary uploads
    const response = await axios.post(
      `http://localhost:3005/api/chat/upload-cloudinary`,
      {
        image: compressedImage,
        folder: folder,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 15000, // 15 second timeout
      }
    );

    if (response.data && response.data.url) {
      console.log("Image successfully uploaded to Cloudinary");
      return response.data.url;
    } else {
      throw new Error("No image URL returned from server");
    }
  } catch (error: any) {
    console.error("Error uploading image to Cloudinary:", error);
    throw new Error(
      error.response?.data?.message || "Failed to upload image to Cloudinary"
    );
  }
};

/**
 * Upload any file to server using FormData 
 * Supports images, videos, audio, and documents
 * @param file File to upload
 * @param onProgress Optional callback for upload progress
 * @returns Object containing file URL and metadata
 */
export const uploadFile = async (
  file: File,
  onProgress?: (progress: number) => void
): Promise<{
  fileUrl: string;
  fileName: string;
  fileSize: number;
  fileThumbnail?: string;
  fileId?: string;
  [key: string]: any;
}> => {
  try {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("Authentication token not found");

    // Create FormData object
    const formData = new FormData();
    formData.append("file", file);
    
    // Determine file type
    let fileType = "file";
    if (file.type.startsWith("image/")) fileType = "image";
    else if (file.type.startsWith("video/")) fileType = "video";
    else if (file.type.startsWith("audio/")) fileType = "audio";
    
    // Add file type to request
    formData.append("type", fileType);
    
    // Determine API endpoint based on file size
    const isLargeFile = file.size > 5 * 1024 * 1024; // 5MB
    const endpoint = isLargeFile 
      ? "http://localhost:3005/api/chat/upload-cloudinary" 
      : "http://localhost:3005/api/chat/upload";

    console.log(`Uploading ${fileType} (${Math.round(file.size/1024)}KB) to ${endpoint}`);
    
    // Adjust timeout based on file size 
    const baseTimeout = 30000; // 30 seconds
    const timeoutPerMB = 5000; // 5 seconds per MB
    const fileSizeMB = file.size / (1024 * 1024);
    const calculatedTimeout = Math.min(
      baseTimeout + (fileSizeMB * timeoutPerMB), 
      10 * 60 * 1000 // Max 10 minutes
    );
    
    // Execute the upload request
    const response = await axios.post(endpoint, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
        "Authorization": `Bearer ${token}`
      },
      timeout: calculatedTimeout,
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total && onProgress) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      }
    });
    
    // Extract file data from response
    if (response.data) {
      if (response.data.file) {
        // New response format
        return response.data.file;
      } else if (response.data.fileUrl) {
        // Legacy response format
        return {
          fileUrl: response.data.fileUrl,
          fileName: response.data.fileName || file.name,
          fileSize: response.data.fileSize || file.size,
          fileThumbnail: response.data.fileThumbnail,
          fileId: response.data.fileId,
        };
      }
    }
    
    throw new Error("Invalid response format from server");
  } catch (error: any) {
    console.error("Error uploading file:", error);
    
    // Try alternative upload method if first one fails
    // Only for regular uploads, not for large files
    if (file.size <= 5 * 1024 * 1024) {
      try {
        console.log("Primary upload failed, trying alternative upload endpoint...");
        
        const formData = new FormData();
        formData.append("file", file);
        
        let fileType = "file";
        if (file.type.startsWith("image/")) fileType = "image";
        else if (file.type.startsWith("video/")) fileType = "video";
        else if (file.type.startsWith("audio/")) fileType = "audio";
        
        formData.append("type", fileType);
        
        const token = localStorage.getItem("token");
        const response = await axios.post(
          "http://localhost:3005/api/chat/upload",
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
              "Authorization": `Bearer ${token}`
            },
            timeout: 60000,
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total && onProgress) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                onProgress(percentCompleted);
              }
            }
          }
        );
        
        if (response.data && (response.data.fileUrl || response.data.file)) {
          if (response.data.file) {
            return response.data.file;
          } else {
            return {
              fileUrl: response.data.fileUrl,
              fileName: response.data.fileName || file.name,
              fileSize: response.data.fileSize || file.size,
              fileThumbnail: response.data.fileThumbnail,
              fileId: response.data.fileId,
            };
          }
        }
      } catch (alternativeError) {
        console.error("Alternative upload also failed:", alternativeError);
      }
    }
    
    // Re-throw original error if all attempts fail
    throw new Error(error.response?.data?.message || 'Failed to upload file');
  }
};
