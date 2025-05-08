import React, { useContext, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../../config/api';
import { AuthContext } from '../../context/AuthContext';

interface Member {
  _id: string;
  name: string;
  avt: string;
  email?: string;
}

interface GroupInfo {
  _id: string;
  name: string;
  description?: string;
  members: Member[];
  admin: Member;
  coAdmins: Member[];
  createdAt: string;
}

const GroupDetailsScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useContext(AuthContext);
  const { groupId } = route.params || {};

  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [userPermissions, setUserPermissions] = useState({
    isAdmin: false,
    isCoAdmin: false,
  });
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [contacts, setContacts] = useState<Member[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);

  useEffect(() => {
    if (groupId) {
      loadGroupInfo();
      checkUserPermissions();
    }
  }, [groupId]);

  const loadGroupInfo = async () => {
    try {
      setLoading(true);
      
      // Get token from storage
      const token = await AsyncStorage.getItem('token');
      
      if (!token) {
        console.error("No auth token available");
        Alert.alert("Error", "Authentication required. Please log in again.");
        return;
      }
      
      // Get group details
      const response = await axios.get(`${API_URL}/api/groups/${groupId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.data) {
        setGroupInfo(response.data);
      }
    } catch (error) {
      console.error('Failed to load group info:', error);
      Alert.alert('Error', 'Failed to load group information.');
    } finally {
      setLoading(false);
    }
  };

  const checkUserPermissions = async () => {
    try {
      // Get token from storage
      const token = await AsyncStorage.getItem('token');
      
      if (!token) {
        return;
      }
      
      // Check permissions
      const response = await axios.get(`${API_URL}/api/groups/${groupId}/check-permissions`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.data) {
        setUserPermissions({
          isAdmin: response.data.isAdmin,
          isCoAdmin: response.data.isCoAdmin,
        });
      }
    } catch (error) {
      console.error('Failed to check permissions:', error);
    }
  };

  const loadContacts = async () => {
    try {
      setLoadingContacts(true);
      
      // Get token from storage
      const token = await AsyncStorage.getItem('token');
      
      if (!token) {
        return;
      }
      
      // Get contacts
      const response = await axios.get(`${API_URL}/api/friendship`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.data && Array.isArray(response.data)) {
        // Process friendship data to get contacts
        const contactsList = response.data
          .filter(friendship => friendship.status === 'accepted')
          .map(friendship => {
            // Determine which user is the friend
            const friendData = friendship.requester?._id === user?._id 
              ? friendship.recipient 
              : friendship.requester;
              
            return {
              _id: friendData?._id || '',
              name: friendData?.name || 'Unknown',
              email: friendData?.email || '',
              avt: friendData?.avt || ''
            };
          })
          .filter(contact => contact._id); // Filter out any invalid contacts
        
        // Filter out members already in the group
        const existingMemberIds = groupInfo?.members.map(m => m._id) || [];
        const filteredContacts = contactsList.filter(
          contact => !existingMemberIds.includes(contact._id)
        );
        
        setContacts(filteredContacts);
        console.log(`Loaded ${filteredContacts.length} contacts for potential adding to group`);
      }
    } catch (error) {
      console.error('Failed to load contacts:', error);
      // Try a secondary endpoint as fallback
      try {
        console.log('Trying alternate endpoint for contacts...');
        const token = await AsyncStorage.getItem('token');
        const response = await axios.get(`${API_URL}/api/friends`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.data && Array.isArray(response.data)) {
          // Filter out members already in the group
          const existingMemberIds = groupInfo?.members.map(m => m._id) || [];
          const filteredContacts = response.data.filter(
            contact => !existingMemberIds.includes(contact._id)
          );
          
          setContacts(filteredContacts);
          console.log(`Loaded ${filteredContacts.length} contacts from alternate endpoint`);
        }
      } catch (fallbackError) {
        console.error('Fallback endpoint also failed:', fallbackError);
        Alert.alert('Error', 'Could not load your contacts. Please try again later.');
      }
    } finally {
      setLoadingContacts(false);
    }
  };

  const addMember = async (memberId: string) => {
    try {
      // Get token from storage
      const token = await AsyncStorage.getItem('token');
      
      if (!token) {
        return;
      }
      
      // Add member to group
      await axios.post(
        `${API_URL}/api/groups/add-member`,
        {
          groupId,
          memberId,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Reload group info
      loadGroupInfo();
      
      // Close modal
      setShowAddMemberModal(false);
    } catch (error) {
      console.error('Failed to add member:', error);
      Alert.alert('Error', 'Failed to add member to group.');
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      // Don't allow removing the admin
      if (groupInfo?.admin._id === memberId) {
        Alert.alert('Error', 'Cannot remove the group admin.');
        return;
      }
      
      // Confirm before removing
      Alert.alert(
        'Remove Member',
        'Are you sure you want to remove this member from the group?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              // Get token from storage
              const token = await AsyncStorage.getItem('token');
              
              if (!token) {
                return;
              }
              
              // Remove member from group
              await axios.post(
                `${API_URL}/api/groups/remove-member`,
                {
                  groupId,
                  memberId,
                },
                {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  }
                }
              );
              
              // Reload group info
              loadGroupInfo();
            },
          },
        ]
      );
    } catch (error) {
      console.error('Failed to remove member:', error);
      Alert.alert('Error', 'Failed to remove member from group.');
    }
  };

  const promoteToCoAdmin = async (memberId: string) => {
    try {
      // Get token from storage
      const token = await AsyncStorage.getItem('token');
      
      if (!token) {
        return;
      }
      
      // Add co-admin
      await axios.post(
        `${API_URL}/api/groups/add-co-admin`,
        {
          groupId,
          userId: memberId,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Reload group info
      loadGroupInfo();
    } catch (error) {
      console.error('Failed to promote to co-admin:', error);
      Alert.alert('Error', 'Failed to promote member to co-admin.');
    }
  };

  const demoteFromCoAdmin = async (memberId: string) => {
    try {
      // Get token from storage
      const token = await AsyncStorage.getItem('token');
      
      if (!token) {
        return;
      }
      
      // Remove co-admin
      await axios.post(
        `${API_URL}/api/groups/remove-co-admin`,
        {
          groupId,
          userId: memberId,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Reload group info
      loadGroupInfo();
    } catch (error) {
      console.error('Failed to demote from co-admin:', error);
      Alert.alert('Error', 'Failed to demote co-admin.');
    }
  };

  const leaveGroup = async () => {
    // Confirm before leaving
    Alert.alert(
      'Leave Group',
      'Are you sure you want to leave this group?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              // Get token from storage
              const token = await AsyncStorage.getItem('token');
              
              if (!token) {
                return;
              }
              
              // Leave group (remove self)
              await axios.post(
                `${API_URL}/api/groups/remove-member`,
                {
                  groupId,
                  memberId: user._id,
                },
                {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  }
                }
              );
              
              // Navigate back to chats
              navigation.navigate('Chat');
            } catch (error) {
              console.error('Failed to leave group:', error);
              Alert.alert('Error', 'Failed to leave group.');
            }
          },
        },
      ]
    );
  };

  const deleteGroup = async () => {
    // Confirm before deleting
    Alert.alert(
      'Delete Group',
      'Are you sure you want to delete this group? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Get token from storage
              const token = await AsyncStorage.getItem('token');
              
              if (!token) {
                return;
              }
              
              // Delete group
              await axios.delete(`${API_URL}/api/groups/${groupId}`, {
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              });
              
              // Navigate back to chats
              navigation.navigate('Chat');
            } catch (error) {
              console.error('Failed to delete group:', error);
              Alert.alert('Error', 'Failed to delete group.');
            }
          },
        },
      ]
    );
  };

  const handleOpenAddMemberModal = () => {
    setShowAddMemberModal(true);
    loadContacts();
  };

  const navigateToGroupChat = () => {
    if (groupInfo) {
      navigation.navigate('GroupChat', {
        groupId: groupInfo._id,
        groupName: groupInfo.name
      });
    }
  };

  // Filter contacts by search text
  const filteredContacts = contacts.filter(contact => 
    contact.name.toLowerCase().includes(searchText.toLowerCase()) ||
    (contact.email && contact.email.toLowerCase().includes(searchText.toLowerCase()))
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007BFF" />
      </SafeAreaView>
    );
  }

  if (!groupInfo) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text>Group not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Group Details</Text>
        <View style={styles.headerRightPlaceholder} />
      </View>

      <View style={styles.groupInfoContainer}>
        <View style={styles.groupAvatarContainer}>
          <View style={styles.groupAvatar}>
            <Text style={styles.groupInitial}>{groupInfo.name.charAt(0)}</Text>
          </View>
        </View>
        <Text style={styles.groupName}>{groupInfo.name}</Text>
        {groupInfo.description && (
          <Text style={styles.groupDescription}>{groupInfo.description}</Text>
        )}
        <Text style={styles.memberCount}>
          {groupInfo.members.length} {groupInfo.members.length === 1 ? 'Member' : 'Members'}
        </Text>
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity 
          style={styles.actionButton}
          onPress={navigateToGroupChat}
        >
          <Ionicons name="chatbubbles" size={24} color="#007BFF" />
          <Text style={styles.actionButtonText}>Chat</Text>
        </TouchableOpacity>
        
        {(userPermissions.isAdmin || userPermissions.isCoAdmin) && (
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={handleOpenAddMemberModal}
          >
            <Ionicons name="person-add" size={24} color="#007BFF" />
            <Text style={styles.actionButtonText}>Add Members</Text>
          </TouchableOpacity>
        )}
        
        {!userPermissions.isAdmin && (
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={leaveGroup}
          >
            <Ionicons name="exit-outline" size={24} color="#FF3B30" />
            <Text style={[styles.actionButtonText, styles.leaveText]}>Leave Group</Text>
          </TouchableOpacity>
        )}
        
        {userPermissions.isAdmin && (
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={deleteGroup}
          >
            <Ionicons name="trash-outline" size={24} color="#FF3B30" />
            <Text style={[styles.actionButtonText, styles.leaveText]}>Delete Group</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.membersSection}>
        <Text style={styles.sectionTitle}>Members</Text>
        
        <FlatList
          data={groupInfo.members}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => {
            const isAdmin = item._id === groupInfo.admin._id;
            const isCoAdmin = groupInfo.coAdmins.some(admin => admin._id === item._id);
            const currentUser = item._id === user._id;
            
            return (
              <View style={styles.memberItem}>
                <Image 
                  source={{ uri: item.avt || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.name) }} 
                  style={styles.memberAvatar} 
                />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>
                    {item.name} {currentUser ? '(You)' : ''}
                  </Text>
                  {isAdmin && (
                    <Text style={styles.adminBadge}>Admin</Text>
                  )}
                  {isCoAdmin && (
                    <Text style={styles.coAdminBadge}>Co-Admin</Text>
                  )}
                </View>
                
                {(userPermissions.isAdmin || userPermissions.isCoAdmin) && !currentUser && (
                  <TouchableOpacity
                    style={styles.memberActionButton}
                    onPress={() => {
                      const buttons: Array<any> = [
                        {
                          text: 'Cancel',
                          style: 'cancel' as 'cancel',
                        }
                      ];
                      
                      if (userPermissions.isAdmin && !isAdmin && !isCoAdmin) {
                        buttons.push({
                          text: 'Promote to Co-Admin',
                          onPress: () => promoteToCoAdmin(item._id),
                          style: 'default' as 'default',
                        });
                      }
                      
                      if (userPermissions.isAdmin && isCoAdmin) {
                        buttons.push({
                          text: 'Remove from Co-Admin',
                          onPress: () => demoteFromCoAdmin(item._id),
                          style: 'default' as 'default',
                        });
                      }
                      
                      if ((userPermissions.isAdmin && !isAdmin) || 
                          (userPermissions.isCoAdmin && !isAdmin && !isCoAdmin)) {
                        buttons.push({
                          text: 'Remove from Group',
                          style: 'destructive' as 'destructive',
                          onPress: () => removeMember(item._id),
                        });
                      }
                      
                      Alert.alert(
                        'Member Actions',
                        `Select an action for ${item.name}`,
                        buttons
                      );
                    }}
                  >
                    <Ionicons name="ellipsis-vertical" size={20} color="#666" />
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      </View>

      {/* Add Member Modal */}
      <Modal
        visible={showAddMemberModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddMemberModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Members</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowAddMemberModal(false)}
              >
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.searchInput}
              placeholder="Search contacts..."
              value={searchText}
              onChangeText={setSearchText}
              placeholderTextColor="#999"
            />
            
            {loadingContacts ? (
              <ActivityIndicator style={styles.loader} size="large" color="#007BFF" />
            ) : (
              <FlatList
                data={filteredContacts}
                keyExtractor={(item) => item._id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.contactItem}
                    onPress={() => addMember(item._id)}
                  >
                    <Image 
                      source={{ uri: item.avt || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(item.name) }} 
                      style={styles.contactAvatar} 
                    />
                    <View style={styles.contactInfo}>
                      <Text style={styles.contactName}>{item.name}</Text>
                      {item.email && (
                        <Text style={styles.contactEmail}>{item.email}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.addButton}
                      onPress={() => addMember(item._id)}
                    >
                      <Ionicons name="add" size={24} color="#FFF" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No contacts available to add</Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerRightPlaceholder: {
    width: 40,
  },
  groupInfoContainer: {
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  groupAvatarContainer: {
    marginBottom: 16,
  },
  groupAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007BFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupInitial: {
    fontSize: 36,
    color: '#FFF',
    fontWeight: 'bold',
  },
  groupName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  groupDescription: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
  },
  memberCount: {
    fontSize: 14,
    color: '#999',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  actionButton: {
    alignItems: 'center',
  },
  actionButtonText: {
    marginTop: 8,
    color: '#007BFF',
  },
  leaveText: {
    color: '#FF3B30',
  },
  membersSection: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  memberAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  memberInfo: {
    marginLeft: 12,
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
  },
  adminBadge: {
    fontSize: 12,
    color: '#FF9500',
    marginTop: 4,
    fontWeight: 'bold',
  },
  coAdminBadge: {
    fontSize: 12,
    color: '#5AC8FA',
    marginTop: 4,
    fontWeight: 'bold',
  },
  memberActionButton: {
    padding: 8,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },
  searchInput: {
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  loader: {
    marginTop: 20,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  contactInfo: {
    marginLeft: 12,
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
  },
  contactEmail: {
    color: '#666',
    marginTop: 4,
    fontSize: 14,
  },
  addButton: {
    backgroundColor: '#007BFF',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
});

export default GroupDetailsScreen; 