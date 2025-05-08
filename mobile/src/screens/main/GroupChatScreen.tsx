import React, { useState, useEffect, useRef, useContext } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext';
import * as groupChatService from '../../services/groupChatService';
import socketService from '../../services/socketService';
import { format } from 'date-fns';
import uuid from 'react-native-uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../../config/api';

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

const GroupChatScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useContext(AuthContext);
  const { groupId, groupName } = route.params as GroupChatParams;
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isMounted, setIsMounted] = useState(true);
  const [typingUsers, setTypingUsers] = useState<{[key: string]: string}>({});
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  
  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<any>(null);

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
        console.error('Failed to get socket instance');
        return;
      }
      
      socketRef.current = socket;

      // Join the group room using both methods for compatibility
      console.log('Initializing group socket connection...');
      
      // Legacy method (should now call our new method internally)
      const joinLegacySuccess = await socketService.joinChatRoom(groupId, true);
      console.log(`Joined group chat room with legacy method: ${groupId}, success: ${joinLegacySuccess}`);
      
      // Also directly call new method for additional robustness
      const joinSuccess = await socketService.joinGroupRoom(groupId);
      console.log(`Joined group chat room with direct method: ${groupId}, success: ${joinSuccess}`);
      
      // Join with explicit group format as additional fallback
      if (socket.connected) {
        // Multiple message formats for maximum compatibility with server
        socket.emit('joinGroupRoom', { groupId });
        console.log(`Explicitly joined group room: ${groupId}`);
        
        socket.emit('joinRoom', { roomId: `group:${groupId}` });
        console.log(`Joined room (group): group:${groupId}`);
      } else {
        console.warn('Socket not connected when joining group room');
      }
      
      // Listen for new messages
      socket.off('groupMessage'); // Remove any existing listeners
      socket.on('groupMessage', handleNewMessage);
      
      // Listen for other events
      socket.off('messageDeleted');
      socket.on('messageDeleted', handleMessageDeleted);
      
      socket.off('messageReaction');
      socket.on('messageReaction', handleMessageReaction);
      
      // Listen for typing events
      socket.off('userTyping');
      socket.on('userTyping', (data: { userId: string, userName: string, groupId: string }) => {
        if (data.groupId === groupId && data.userId !== user._id) {
          console.log(`${data.userName} is typing...`);
          setTypingUsers(prev => ({
            ...prev,
            [data.userId]: data.userName
          }));
          
          // Auto remove typing indicator after 3 seconds
          setTimeout(() => {
            setTypingUsers(prev => {
              const updated = {...prev};
              delete updated[data.userId];
              return updated;
            });
          }, 3000);
        }
      });
      
      socket.off('userStoppedTyping');
      socket.on('userStoppedTyping', (data: { userId: string, groupId: string }) => {
        if (data.groupId === groupId) {
          setTypingUsers(prev => {
            const updated = {...prev};
            delete updated[data.userId];
            return updated;
          });
        }
      });
      
      // Request any missed messages
      socketService.requestMissedMessages(groupId, true);
      console.log(`Requested missed messages for group: ${groupId}`);
    } catch (error) {
      console.error('Error setting up socket:', error);
    }
  };

  const cleanupSocket = () => {
    if (socketRef.current) {
      socketRef.current.off('groupMessage');
      socketRef.current.off('messageDeleted');
      socketRef.current.off('messageReaction');
      socketRef.current.off('userTyping');
      socketRef.current.off('userStoppedTyping');
      if (socketRef.current.connected) {
        socketRef.current.emit('leaveRoom', { roomId: `group:${groupId}` });
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
      console.error('Failed to load messages:', error);
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
      console.log(`Ignoring message for different group: ${message.groupId || message.roomId}`);
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
      setMessages(prevMessages => {
        // Check if we already have this message by _id or tempId
        const messageExists = prevMessages.some(
          m => (m._id === message._id) || 
             (message.tempId && m.tempId === message.tempId)
        );
        
        if (messageExists) {
          console.log(`Message ${message._id} already exists in state, not adding again`);
          return prevMessages;
        }
        
        console.log(`Adding new group message to state: ${message._id}`);
        // Add the new message
        return [...prevMessages, message];
      });
      
      // Scroll to the new message
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  const handleMessageDeleted = (data: { messageId: string }) => {
    if (isMounted) {
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg._id === data.messageId 
            ? { ...msg, isUnsent: true, content: 'This message has been deleted' } 
            : msg
        )
      );
    }
  };

  const handleMessageReaction = (data: { 
    messageId: string, 
    userId: string, 
    emoji: string 
  }) => {
    if (isMounted) {
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg._id === data.messageId 
            ? { 
                ...msg, 
                reactions: { 
                  ...(msg.reactions || {}), 
                  [data.userId]: data.emoji 
                } 
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
      socketRef.current.emit('typing', {
        userId: user._id,
        userName: user.name,
        groupId: groupId,
        isGroup: true
      });
      
      // Clear any existing timeout
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
      
      // Set new timeout to stop typing after 2 seconds
      const timeout = setTimeout(() => {
        if (socketRef.current && socketRef.current.connected) {
          socketRef.current.emit('stopTyping', {
            userId: user._id,
            groupId: groupId,
            isGroup: true
          });
        }
      }, 2000);
      
      setTypingTimeout(timeout);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;
    
    try {
      setSending(true);
      
      // Create a temporary ID for the message
      const tempId = uuid.v4() as string;
      
      // Create temporary message to show immediately
      const tempMessage: Message = {
        _id: tempId,
        content: inputMessage.trim(),
        sender: {
          _id: user._id,
          name: user.name,
          avt: user.avt,
        },
        groupId: groupId,
        createdAt: new Date().toISOString(),
        tempId: tempId,
        type: 'text',
      };
      
      // Add to local messages for immediate feedback
      if (isMounted) {
        setMessages(prev => [...prev, tempMessage]);
        setInputMessage('');
        
        // Scroll to the new message
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
      
      console.log(`Sending group message: ${tempMessage.content} to group ${groupId} with tempId ${tempId}`);
      
      // If socket not connected, reconnect it
      if (!socketRef.current || !socketRef.current.connected) {
        console.log('Socket not connected, reconnecting...');
        try {
          const socket = await socketService.initSocket();
          if (socket) {
            socketRef.current = socket;
            // Rejoin the group room
            socket.emit('joinGroupRoom', { groupId });
            console.log(`Rejoined group room: ${groupId}`);
          }
        } catch (error) {
          console.error('Failed to reconnect socket:', error);
        }
      }
      
      // Try socket first
      let socketSuccess = false;
      if (socketRef.current && socketRef.current.connected) {
        try {
          socketSuccess = await groupChatService.emitGroupMessage({
            roomId: groupId,
            groupId: groupId,
            content: tempMessage.content,
            sender: user._id,
            senderId: user._id,
            type: 'text',
            tempId: tempId,
          });
          console.log(`Socket send result: ${socketSuccess ? 'success' : 'failed'}`);
        } catch (socketError) {
          console.error('Socket send error:', socketError);
        }
      } else {
        console.log('Socket not connected, skipping socket send');
      }
      
      // If socket failed or not connected, fall back to API
      if (!socketSuccess) {
        console.log('Falling back to API for group message');
        try {
          const token = await AsyncStorage.getItem('token');
          if (!token) {
            throw new Error('No auth token available');
          }
          
          const apiResponse = await axios.post(
            `${API_URL}/api/groups/message`,
            {
              groupId: groupId,
              content: tempMessage.content,
              type: 'text',
              tempId: tempId
            },
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          console.log('Group message API response:', apiResponse.status, apiResponse.data && apiResponse.data._id);
          
          if (apiResponse.data && apiResponse.data._id) {
            // Update the temporary message with the real ID
            setMessages(prev => 
              prev.map(msg => 
                msg.tempId === tempId 
                  ? { ...msg, _id: apiResponse.data._id } 
                  : msg
              )
            );
          }
        } catch (apiError) {
          console.error('API send failed:', apiError);
          // Mark message as failed in UI
          setMessages(prev => 
            prev.map(msg => 
              msg.tempId === tempId 
                ? { ...msg, failed: true } 
                : msg
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
                  setMessages(prev => prev.filter(msg => msg.tempId !== tempId));
                  setInputMessage(tempMessage.content);
                }
              },
              {
                text: "Hủy",
                style: "cancel"
              }
            ]
          );
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      if (isMounted) {
        setSending(false);
      }
    }
  };

  const navigateToGroupDetails = () => {
    navigation.navigate('GroupDetails', { groupId });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isCurrentUser = item.sender._id === user._id;
    const messageTime = format(new Date(item.createdAt), 'HH:mm');
    
    return (
      <View style={[
        styles.messageContainer,
        isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage
      ]}>
        {!isCurrentUser && (
          <Image 
            source={{ uri: item.sender.avt || 'https://via.placeholder.com/40' }} 
            style={styles.avatar} 
          />
        )}
        
        <View style={[
          styles.messageBubble,
          isCurrentUser ? styles.currentUserBubble : styles.otherUserBubble,
          item.failed ? styles.failedMessage : {}
        ]}>
          {!isCurrentUser && (
            <Text style={styles.messageSender}>{item.sender.name}</Text>
          )}
          
          {item.isUnsent ? (
            <Text style={styles.deletedMessage}>This message has been deleted</Text>
          ) : (
            <Text style={styles.messageText}>{item.content}</Text>
          )}
          
          <Text style={styles.messageTime}>
            {messageTime}
            {item.failed && " (Failed)"}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        
        <TouchableOpacity onPress={navigateToGroupDetails} style={styles.groupInfo}>
          <Text style={styles.groupName}>{groupName}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity onPress={navigateToGroupDetails}>
          <Ionicons name="information-circle-outline" size={24} color="#0084ff" />
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
              <Text style={styles.emptySubtext}>Be the first to send a message!</Text>
            </View>
          }
        />
      )}
      
      {/* Typing indicator */}
      {Object.values(typingUsers).length > 0 && (
        <View style={styles.typingIndicator}>
          <Text style={styles.typingText}>
            {Object.values(typingUsers).join(', ')} {Object.values(typingUsers).length > 1 ? 'are typing...' : 'is typing...'}
          </Text>
        </View>
      )}
      
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            value={inputMessage}
            onChangeText={handleTyping}
            multiline
          />
          
          <TouchableOpacity 
            style={styles.sendButton} 
            onPress={sendMessage}
            disabled={sending || !inputMessage.trim()}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
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
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesList: {
    padding: 16,
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    maxWidth: '80%',
  },
  currentUserMessage: {
    alignSelf: 'flex-end',
  },
  otherUserMessage: {
    alignSelf: 'flex-start',
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
    maxWidth: '100%',
  },
  currentUserBubble: {
    backgroundColor: '#0084ff',
  },
  otherUserBubble: {
    backgroundColor: '#e4e6eb',
  },
  messageSender: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
  },
  messageText: {
    fontSize: 16,
    color: '#000',
  },
  messageTime: {
    fontSize: 10,
    color: '#888',
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  deletedMessage: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#888',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#f0f2f5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#0084ff',
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#888',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
  },
  typingIndicator: {
    backgroundColor: '#f0f2f5',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  typingText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  failedMessage: {
    backgroundColor: '#ffdddd',
    borderWidth: 1,
    borderColor: '#ffaaaa',
  },
});

export default GroupChatScreen; 