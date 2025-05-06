import React, { useState, useEffect } from "react";
import { FiX, FiUserCheck, FiUserX, FiInfo } from "react-icons/fi";
import "../scss/CoAdminDialog.scss";
import axios from "axios";
import { Group, GroupMember } from "./GroupChatTypes";

interface CoAdminDialogProps {
  isOpen: boolean;
  groupId: string;
  group: Group;
  userId: string;
  onClose: () => void;
  onCoAdminUpdated: () => void;
  socket: any;
}

// Component Dialog thông báo tùy chỉnh
interface CustomAlertProps {
  isOpen: boolean;
  message: string;
  onClose: () => void;
}

const CustomAlert: React.FC<CustomAlertProps> = ({
  isOpen,
  message,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="custom-alert-overlay" onClick={onClose}>
      <div
        className="custom-alert-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="custom-alert-message">{message}</div>
        <button className="custom-alert-button" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
};

// Component hiển thị thông tin quyền phó nhóm
const CoAdminPermissionsInfo: React.FC = () => {
  return (
    <div className="coadmin-permissions-info">
      <h3>
        <FiInfo /> Quyền hạn của phó nhóm
      </h3>
      <ul>
        <li>Thêm thành viên mới vào nhóm</li>
        <li>
          Xóa thành viên thường khỏi nhóm (không xóa được admin hoặc phó nhóm
          khác)
        </li>
        <li>Xóa tin nhắn trong nhóm</li>
        <li>Chỉnh sửa tên nhóm</li>
        <li>Quản lý thư viện media</li>
      </ul>
      <p className="permission-note">
        Lưu ý: Phó nhóm không có quyền xóa nhóm, thêm/xóa phó nhóm khác hoặc
        chuyển quyền admin
      </p>
    </div>
  );
};

const CoAdminDialog: React.FC<CoAdminDialogProps> = ({
  isOpen,
  groupId,
  group,
  userId,
  onClose,
  onCoAdminUpdated,
  socket,
}) => {
  const [selectedCoAdminAction, setSelectedCoAdminAction] = useState<
    "add" | "remove" | "info"
  >("add");
  const [coAdminSearchTerm, setCoAdminSearchTerm] = useState("");
  const [coAdminSearchResults, setCoAdminSearchResults] = useState<
    GroupMember[]
  >([]);

  // Animation control
  const [isShowing, setIsShowing] = useState(false);

  // State cho dialog thông báo
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");

  // State lưu trữ thông tin nhóm mới nhất
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);

  // Hàm hiển thị thông báo tùy chỉnh
  const showCustomAlert = (message: string) => {
    setAlertMessage(message);
    setAlertOpen(true);
  };

  // Hàm lấy lại thông tin nhóm mới nhất
  const refreshGroupInfo = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await axios.get(
        `http://localhost:3005/api/groups/${groupId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.data) {
        console.log("Nhóm data từ API:", response.data);
        setCurrentGroup(response.data);
        return response.data;
      }
      return null;
    } catch (error) {
      console.error("Error fetching group info:", error);
      return null;
    }
  };

  useEffect(() => {
    if (isOpen) {
      setIsShowing(true);
      refreshGroupInfo().then((updatedGroup) => {
        if (updatedGroup) {
          // Hiển thị tất cả thành viên khi mở dialog
          handleSearch(updatedGroup);
        } else {
          handleSearch(group);
        }
      });
    } else {
      setTimeout(() => {
        setIsShowing(false);
      }, 300);
    }
  }, [isOpen, groupId]);

  // Khi chuyển tab, cập nhật lại thông tin nhóm
  useEffect(() => {
    if (selectedCoAdminAction === "remove") {
      refreshGroupInfo().then((updatedGroup) => {
        console.log("Đã cập nhật thông tin nhóm khi chuyển tab:", updatedGroup);
      });
    }
  }, [selectedCoAdminAction]);

  if (!isOpen && !isShowing) {
    return null;
  }

  const handleSearch = (targetGroup = currentGroup || group) => {
    let results: GroupMember[] = [];

    // Nếu có từ khóa tìm kiếm, lọc theo từ khóa
    if (coAdminSearchTerm.trim()) {
      results = targetGroup.members.filter((member) => {
        // Chỉ lấy các thành viên là object để có thể truy cập thuộc tính name
        if (typeof member === "object" && member !== null) {
          return member.name
            .toLowerCase()
            .includes(coAdminSearchTerm.toLowerCase());
        }
        return false;
      }) as GroupMember[];
    } else {
      // Nếu không có từ khóa, hiển thị tất cả thành viên
      results = targetGroup.members.filter(
        (member) => typeof member === "object" && member !== null
      ) as GroupMember[];
    }

    // Lọc ra những người đã là admin hoặc phó nhóm
    const filteredResults = results.filter((member) => {
      const memberId = typeof member === "object" ? member._id : member;
      const isAdmin =
        typeof targetGroup.admin === "object"
          ? targetGroup.admin._id === memberId
          : targetGroup.admin === memberId;
      const isCoAdmin =
        Array.isArray(targetGroup.coAdmins) &&
        targetGroup.coAdmins.includes(memberId);

      return !isAdmin && !isCoAdmin;
    });

    setCoAdminSearchResults(filteredResults);
  };

  const handleAddCoAdmin = async (memberId: string, memberName: string) => {
    try {
      const token = localStorage.getItem("token");
      const response = await axios.post(
        `http://localhost:3005/api/groups/add-co-admin`,
        {
          groupId,
          userId: memberId,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // Thông báo qua socket
      if (socket) {
        socket.emit("addCoAdmin", {
          groupId,
          userId: memberId,
          addedBy: userId,
        });
      }

      // Cập nhật thông tin nhóm mới
      await refreshGroupInfo();

      // Thông báo thành công và cập nhật thông tin nhóm
      showCustomAlert(`Đã thăng cấp ${memberName} làm phó nhóm`);
      onCoAdminUpdated();
    } catch (error) {
      console.error("Error adding co-admin:", error);
      // Hiển thị thông báo lỗi chi tiết từ phản hồi API
      if (
        error.response &&
        error.response.data &&
        error.response.data.message
      ) {
        showCustomAlert(error.response.data.message);
      } else {
        showCustomAlert(
          "Không thể thăng cấp thành viên. Vui lòng thử lại sau."
        );
      }
    }
  };

  const handleRemoveCoAdmin = async (memberId: string, memberName: string) => {
    try {
      const token = localStorage.getItem("token");
      await axios.post(
        `http://localhost:3005/api/groups/remove-co-admin`,
        {
          groupId,
          userId: memberId,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // Thông báo qua socket
      if (socket) {
        socket.emit("removeCoAdmin", {
          groupId,
          userId: memberId,
          removedBy: userId,
        });
      }

      // Cập nhật thông tin nhóm mới
      await refreshGroupInfo();

      // Thông báo thành công và cập nhật thông tin nhóm
      showCustomAlert(`Đã hạ cấp ${memberName} xuống thành viên thường`);
      onCoAdminUpdated();
    } catch (error) {
      console.error("Error removing co-admin:", error);
      if (
        error.response &&
        error.response.data &&
        error.response.data.message
      ) {
        showCustomAlert(error.response.data.message);
      } else {
        showCustomAlert("Không thể hạ cấp thành viên. Vui lòng thử lại sau.");
      }
    }
  };

  const renderCurrentCoAdmins = () => {
    const targetGroup = currentGroup || group;
    console.log("Đang hiển thị danh sách phó nhóm:", targetGroup);

    // Kiểm tra nếu không có thành viên nào
    if (
      !targetGroup ||
      !targetGroup.members ||
      targetGroup.members.length === 0
    ) {
      return (
        <div className="no-results">Không có thành viên nào trong nhóm</div>
      );
    }

    // Kiểm tra nếu không có mảng coAdmins
    if (
      !targetGroup.coAdmins ||
      !Array.isArray(targetGroup.coAdmins) ||
      targetGroup.coAdmins.length === 0
    ) {
      return <div className="no-results">Nhóm hiện không có phó nhóm</div>;
    }

    console.log("Danh sách coAdmins:", targetGroup.coAdmins);

    // Lọc ra các thành viên là phó nhóm
    const coAdmins = targetGroup.members.filter((member) => {
      if (!member || typeof member !== "object") return false;

      const memberId = member._id;
      return targetGroup.coAdmins.some((coAdminId) =>
        typeof coAdminId === "string"
          ? coAdminId === memberId
          : typeof coAdminId === "object" &&
            coAdminId &&
            "_id" in coAdminId &&
            (coAdminId as any)._id === memberId
      );
    });

    console.log("Thành viên là phó nhóm đã lọc:", coAdmins);

    if (coAdmins.length === 0) {
      return <div className="no-results">Nhóm hiện không có phó nhóm</div>;
    }

    return (coAdmins as GroupMember[]).map((member) => {
      const memberId = member._id;
      const memberName = member.name || "Unknown";
      const memberAvt = member.avt || null;

      return (
        <div key={memberId} className="member-item">
          <div className="member-avatar">
            {memberAvt ? (
              <img src={memberAvt} alt={memberName} />
            ) : (
              <div className="avatar-placeholder">
                {memberName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="member-info">
            <div className="member-name">{memberName}</div>
          </div>
          <button
            className="demote-button"
            onClick={() => handleRemoveCoAdmin(memberId, memberName)}
          >
            <FiUserX /> Hủy quyền
          </button>
        </div>
      );
    });
  };

  return (
    <>
      <div
        className={`co-admin-dialog-overlay ${isShowing ? "show" : ""}`}
        onClick={onClose}
      >
        <div
          className={`co-admin-dialog-content ${isShowing ? "show" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="co-admin-dialog-header">
            <h3>Quản lý phó nhóm</h3>
            <button className="close-button" onClick={onClose}>
              <FiX />
            </button>
          </div>

          <div className="co-admin-actions">
            <div className="action-tabs">
              <button
                className={`tab-button ${
                  selectedCoAdminAction === "add" ? "active" : ""
                }`}
                onClick={() => {
                  setSelectedCoAdminAction("add");
                  handleSearch(); // Hiển thị tất cả thành viên khi chuyển tab
                }}
              >
                Thêm phó nhóm
              </button>
              <button
                className={`tab-button ${
                  selectedCoAdminAction === "remove" ? "active" : ""
                }`}
                onClick={async () => {
                  setSelectedCoAdminAction("remove");
                  await refreshGroupInfo();
                }}
              >
                Hủy quyền phó nhóm
              </button>
              <button
                className={`tab-button ${
                  selectedCoAdminAction === "info" ? "active" : ""
                }`}
                onClick={() => {
                  setSelectedCoAdminAction("info");
                }}
              >
                Thông tin quyền hạn
              </button>
            </div>

            {selectedCoAdminAction === "add" ? (
              <div className="add-coadmin-section">
                <div className="search-container">
                  <input
                    type="text"
                    placeholder="Tìm kiếm thành viên..."
                    value={coAdminSearchTerm}
                    onChange={(e) => {
                      setCoAdminSearchTerm(e.target.value);
                      // Tìm kiếm ngay khi người dùng gõ
                      handleSearch();
                    }}
                    onKeyUp={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <button
                    className="search-button"
                    onClick={() => handleSearch()}
                  >
                    Tìm kiếm
                  </button>
                </div>

                <div className="search-results">
                  {coAdminSearchResults.map((member) => {
                    const memberId =
                      typeof member === "object" ? member._id : member;
                    const memberName =
                      typeof member === "object" ? member.name : "Unknown";
                    const memberAvt =
                      typeof member === "object" ? member.avt : null;

                    return (
                      <div key={memberId} className="member-item">
                        <div className="member-avatar">
                          {memberAvt ? (
                            <img src={memberAvt} alt={memberName} />
                          ) : (
                            <div className="avatar-placeholder">
                              {memberName.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="member-info">
                          <div className="member-name">{memberName}</div>
                        </div>
                        <button
                          className="promote-button"
                          onClick={() => handleAddCoAdmin(memberId, memberName)}
                        >
                          <FiUserCheck /> Thăng cấp
                        </button>
                      </div>
                    );
                  })}
                  {coAdminSearchResults.length === 0 && (
                    <div className="no-results">
                      {coAdminSearchTerm
                        ? "Không tìm thấy thành viên phù hợp"
                        : "Không có thành viên nào có thể thăng cấp"}
                    </div>
                  )}
                </div>
              </div>
            ) : selectedCoAdminAction === "remove" ? (
              <div className="remove-coadmin-section">
                <h4>Danh sách phó nhóm hiện tại</h4>
                <div className="co-admins-list">{renderCurrentCoAdmins()}</div>
              </div>
            ) : (
              <CoAdminPermissionsInfo />
            )}

            <div className="button-group">
              <button className="cancel-button" onClick={onClose}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Alert Dialog */}
      <CustomAlert
        isOpen={alertOpen}
        message={alertMessage}
        onClose={() => setAlertOpen(false)}
      />
    </>
  );
};

export default CoAdminDialog;
