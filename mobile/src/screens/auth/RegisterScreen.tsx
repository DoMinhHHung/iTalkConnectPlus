import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { API_URL } from "../../config/constants";
import useAuth from "../../hooks/useAuth";
import DateTimePicker from "@react-native-community/datetimepicker";

const RegisterScreen = () => {
  const navigation = useNavigation<any>();
  const { register } = useAuth();

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [address, setAddress] = useState("");

  // UI states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // OTP verification states
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otp, setOtp] = useState("");

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setBirthDate(formatDate(selectedDate));
    }
  };

  const validateForm = () => {
    if (!name.trim()) return "Name is required";
    if (!email.trim()) return "Email is required";
    if (!email.includes("@")) return "Please enter a valid email";
    if (!password.trim()) return "Password is required";
    if (password.length < 6) return "Password should be at least 6 characters";
    if (password !== confirmPassword) return "Passwords do not match";
    if (!phone.trim()) return "Phone number is required";
    if (!gender.trim()) return "Gender is required";
    if (gender !== "male" && gender !== "female")
      return "Gender must be either 'male' or 'female'";
    return null;
  };

  const handleSendOTP = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Send OTP to email
      const response = await axios.post(
        `${API_URL}/api/auth/send-registration-otp`,
        {
          email,
        }
      );

      setIsOtpSent(true);
      Alert.alert(
        "OTP Sent",
        `An OTP has been sent to ${email}. Please check your email.`
      );
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        "Failed to send OTP. Please try again.";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!otp.trim() || otp.length !== 6) {
      setError("Please enter a valid OTP");
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Register user with OTP
      const userData = {
        name,
        email,
        phone,
        password,
        gender,
        birthDate,
        address,
        otp,
      };
      await register(userData);

      // Navigate to main app (will be handled by navigation in App.tsx)
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        "Registration failed. Please try again.";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const navigateToLogin = () => {
    navigation.navigate("Login");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerContainer}>
          <TouchableOpacity style={styles.backButton} onPress={navigateToLogin}>
            <Ionicons name="arrow-back" size={24} color="#2196F3" />
          </TouchableOpacity>
          <Text style={styles.headerText}>Create Account</Text>
        </View>

        <View style={styles.formContainer}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {!isOtpSent ? (
            <>
              <View style={styles.inputContainer}>
                <Ionicons
                  name="person-outline"
                  size={20}
                  color="#999"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Full Name"
                  value={name}
                  onChangeText={(text) => {
                    setName(text);
                    setError("");
                  }}
                />
              </View>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color="#999"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email Address"
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setError("");
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="call-outline"
                  size={20}
                  color="#999"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Phone Number"
                  value={phone}
                  onChangeText={(text) => {
                    setPhone(text);
                    setError("");
                  }}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={styles.genderContainer}>
                <Text style={styles.label}>Gender</Text>
                <View style={styles.genderButtons}>
                  <TouchableOpacity
                    style={[
                      styles.genderButton,
                      gender === "male" && styles.genderButtonActive,
                    ]}
                    onPress={() => {
                      setGender("male");
                      setError("");
                    }}
                  >
                    <Text
                      style={[
                        styles.genderButtonText,
                        gender === "male" && styles.genderButtonTextActive,
                      ]}
                    >
                      Male
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.genderButton,
                      gender === "female" && styles.genderButtonActive,
                    ]}
                    onPress={() => {
                      setGender("female");
                      setError("");
                    }}
                  >
                    <Text
                      style={[
                        styles.genderButtonText,
                        gender === "female" && styles.genderButtonTextActive,
                      ]}
                    >
                      Female
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color="#999"
                  style={styles.inputIcon}
                />
                <TouchableOpacity
                  style={styles.dateInput}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Text
                    style={birthDate ? styles.dateText : styles.datePlaceholder}
                  >
                    {birthDate || "Birth Date (YYYY-MM-DD)"}
                  </Text>
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker
                    value={birthDate ? new Date(birthDate) : new Date()}
                    mode="date"
                    display="default"
                    onChange={handleDateChange}
                    maximumDate={new Date()}
                  />
                )}
              </View>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="location-outline"
                  size={20}
                  color="#999"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Address (optional)"
                  value={address}
                  onChangeText={(text) => {
                    setAddress(text);
                    setError("");
                  }}
                />
              </View>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color="#999"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setError("");
                  }}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  style={styles.passwordToggle}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#999"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color="#999"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChangeText={(text) => {
                    setConfirmPassword(text);
                    setError("");
                  }}
                  secureTextEntry={!showConfirmPassword}
                />
                <TouchableOpacity
                  style={styles.passwordToggle}
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <Ionicons
                    name={
                      showConfirmPassword ? "eye-off-outline" : "eye-outline"
                    }
                    size={20}
                    color="#999"
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.registerButton,
                  (loading ||
                    !name ||
                    !email ||
                    !password ||
                    !confirmPassword) &&
                    styles.buttonDisabled,
                ]}
                onPress={handleSendOTP}
                disabled={
                  loading || !name || !email || !password || !confirmPassword
                }
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Send OTP</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.otpMessage}>
                Please enter the OTP sent to your email address:
              </Text>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="key-outline"
                  size={20}
                  color="#999"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChangeText={(text) => {
                    setOtp(text);
                    setError("");
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>

              <TouchableOpacity
                style={styles.resendButton}
                onPress={handleSendOTP}
                disabled={loading}
              >
                <Text style={styles.resendButtonText}>Resend OTP</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.registerButton,
                  (loading || otp.length !== 6) && styles.buttonDisabled,
                ]}
                onPress={handleRegister}
                disabled={loading || otp.length !== 6}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Verify & Register</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.loginContainer}>
          <Text style={styles.loginText}>Already have an account?</Text>
          <TouchableOpacity onPress={navigateToLogin}>
            <Text style={styles.loginLink}>Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    flexGrow: 1,
    padding: 30,
  },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 30,
  },
  backButton: {
    padding: 5,
  },
  headerText: {
    fontSize: 28,
    fontWeight: "bold",
    marginLeft: 15,
    color: "#333",
  },
  formContainer: {
    marginBottom: 20,
  },
  errorText: {
    color: "#f44336",
    marginBottom: 15,
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 15,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
    color: "#333",
  },
  passwordToggle: {
    padding: 5,
  },
  registerButton: {
    backgroundColor: "#2196F3",
    borderRadius: 8,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#2196F3",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  buttonDisabled: {
    backgroundColor: "#9fc5e8",
    elevation: 0,
    shadowOpacity: 0,
  },
  buttonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
  loginContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
  },
  loginText: {
    color: "#666",
    fontSize: 14,
  },
  loginLink: {
    color: "#2196F3",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 5,
  },
  otpMessage: {
    fontSize: 16,
    color: "#333",
    marginBottom: 20,
    textAlign: "center",
  },
  resendButton: {
    alignSelf: "flex-end",
    marginBottom: 20,
  },
  resendButtonText: {
    color: "#2196F3",
    fontSize: 14,
    fontWeight: "500",
  },
  genderContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    color: "#333",
    marginBottom: 10,
  },
  genderButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  genderButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginHorizontal: 5,
    alignItems: "center",
  },
  genderButtonActive: {
    backgroundColor: "#2196F3",
    borderColor: "#2196F3",
  },
  genderButtonText: {
    fontSize: 16,
    color: "#666",
  },
  genderButtonTextActive: {
    color: "#fff",
  },
  dateInput: {
    flex: 1,
    height: 50,
    justifyContent: "center",
  },
  dateText: {
    fontSize: 16,
    color: "#333",
  },
  datePlaceholder: {
    fontSize: 16,
    color: "#999",
  },
});

export default RegisterScreen;
