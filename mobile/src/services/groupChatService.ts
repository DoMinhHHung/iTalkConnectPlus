import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../config/api';

let socket: Socket | null = null;

export interface GroupMessage {
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
}

export interface GroupInfo {
  _id: string;
  name: string;
  description?: string;
  members: Array<{
    _id: string;
    name: string;
    avt: string;
  }>;
  admin: {
    _id: string;
    name: string;
    avt: string;
  };
  coAdmins: Array<{
    _id: string;
    name: string;
    avt: string;
  }>;
  createdAt: string;
}

// Socket connection functions
export const initGroupSocket = async (): Promise<Socket | null> => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No token available for socket connection');
      return null;
    }
    
    if (!socket || !socket.connected) {
      socket = io(`${API_URL}`, {
        extraHeaders: {
          Authorization: `Bearer ${token}`,
        },
        query: {
          token,
        },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });
      
      socket.on('connect', () => {
        console.log('Group socket connected');
      });
      
      socket.on('connect_error', (error) => {
        console.error('Group socket connection error:', error);
      });
      
      socket.on('disconnect', (reason) => {
        console.log('Group socket disconnected:', reason);
      });
    }
    
    return socket;
  } catch (error) {
    console.error('Error initializing group socket:', error);
    return null;
  }
};

// Emit a new group message through socket AND ensure it's saved via API
export const emitGroupMessage = async (message: any): Promise<boolean> => {
  if (!socket) {
    console.log('Initializing group socket connection...');
    await initGroupSocket();
  }
  
  // Đảm bảo có trường chatType và senderId
  const enhancedMessage = {
    ...message,
    chatType: "group"
  };
  
  if (!enhancedMessage.senderId && enhancedMessage.sender) {
    enhancedMessage.senderId = enhancedMessage.sender;
  }

  // Thử gửi qua socket trước
  let socketSent = false;
  if (socket?.connected) {
    try {
      console.log('Emitting group message to socket with data:', JSON.stringify(enhancedMessage));
      socket.emit('groupMessage', enhancedMessage);
      console.log('Group message emitted to socket server');
      socketSent = true;
    } catch (error) {
      console.error("Error sending message via socket:", error);
    }
  } else {
    console.log('Socket not connected, unable to emit group message via socket');
  }
  
  // Luôn gửi qua API để đảm bảo lưu vào database
  try {
    console.log('Sending same message via API to ensure persistence');
    await sendGroupMessage(enhancedMessage);
    return true;
  } catch (error) {
    console.error('Failed to send message via API:', error);
    return socketSent; // Vẫn trả về true nếu ít nhất socket thành công
  }
};

// Join a group chat room
export const joinGroupRoom = (groupId: string): boolean => {
  if (!socket || !socket.connected) {
    console.log('Socket not connected, unable to join group room');
    return false;
  }
  
  socket.emit('joinGroup', { groupId });
  return true;
};

// Leave a group chat room
export const leaveGroupRoom = (groupId: string): boolean => {
  if (!socket || !socket.connected) {
    console.log('Socket not connected, unable to leave group room');
    return false;
  }
  
  socket.emit('leaveGroup', { groupId });
  return true;
};

// API functions

// Get group details
export const getGroupDetails = async (groupId: string) => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No auth token available');
      return null;
    }
    
    const response = await axios.get(`${API_URL}/api/groups/${groupId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting group details:', error);
    return null;
  }
};

// Get messages for a group
export const getGroupMessages = async (groupId: string, page = 1, limit = 20) => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No auth token available');
      return null;
    }
    
    const response = await axios.get(`${API_URL}/api/groups/${groupId}/messages`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        page,
        limit,
      },
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting group messages:', error);
    return null;
  }
};

// Send a message to a group via API
export const sendGroupMessage = async (message: any) => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No auth token available');
      return null;
    }
    
    // Đảm bảo có trường chatType
    const messageWithType = {
      ...message,
      chatType: "group"
    };
    
    console.log('Sending group message via API:', JSON.stringify(messageWithType));
    
    const response = await axios.post(
      `${API_URL}/api/groups/message`,
      messageWithType,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('Group message API response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending group message:', error);
    return null;
  }
};

// Get all groups for current user
export const getUserGroups = async () => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No auth token available');
      return null;
    }
    
    const response = await axios.get(`${API_URL}/api/groups/user/groups`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting user groups:', error);
    return null;
  }
};

// Create a new group
export const createGroup = async (groupData: {
  name: string;
  members: string[];
  description?: string;
}): Promise<GroupInfo | null> => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No token available for creating group');
      return null;
    }
    
    console.log('Creating group with data:', JSON.stringify({
      name: groupData.name,
      members: `${groupData.members.length} members`,
      description: groupData.description
    }));
    
    const response = await axios.post(
      `${API_URL}/api/groups/create`,
      groupData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      }
    );
    
    console.log('Group creation response:', response.status);
    console.log('Group data received:', response.data?.group?._id ? 'Valid group with ID' : 'Invalid group data');
    
    return response.data.group;
  } catch (error: any) {
    console.error('Error creating group:', error.message);
    
    // Log more detailed error information
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Server error response:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
      });
      
      // If server returned a message, use it
      if (error.response.data && error.response.data.message) {
        throw new Error(error.response.data.message);
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received:', error.request);
      throw new Error('Network error: No response from server');
    } 
    
    throw error;
  }
};

// Add member to group
export const addMemberToGroup = async (groupId: string, memberId: string): Promise<boolean> => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No token available for adding member to group');
      return false;
    }
    
    await axios.post(
      `${API_URL}/api/groups/add-member`,
      {
        groupId,
        memberId,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    return true;
  } catch (error) {
    console.error('Error adding member to group:', error);
    return false;
  }
};

// Remove member from group
export const removeMemberFromGroup = async (groupId: string, memberId: string): Promise<boolean> => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No token available for removing member from group');
      return false;
    }
    
    await axios.post(
      `${API_URL}/api/groups/remove-member`,
      {
        groupId,
        memberId,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    return true;
  } catch (error) {
    console.error('Error removing member from group:', error);
    return false;
  }
};

// Delete a group
export const deleteGroup = async (groupId: string): Promise<boolean> => {
  try {
    const token = await AsyncStorage.getItem('token');
    
    if (!token) {
      console.error('No token available for deleting group');
      return false;
    }
    
    await axios.delete(`${API_URL}/api/groups/${groupId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    return true;
  } catch (error) {
    console.error('Error deleting group:', error);
    return false;
  }
};

export default {
  initGroupSocket,
  emitGroupMessage,
  joinGroupRoom,
  leaveGroupRoom,
  getGroupDetails,
  getGroupMessages,
  sendGroupMessage,
  getUserGroups,
  createGroup,
  addMemberToGroup,
  removeMemberFromGroup,
  deleteGroup,
}; 