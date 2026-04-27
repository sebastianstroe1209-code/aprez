import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
import { useAuth } from '../contexts/AuthContext';

export default function RegisterScreen({ navigation }) {
  const { register, error, setError } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleRegister = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    const success = await register({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      password,
      phone: phone.trim() || undefined,
    });
    setSubmitting(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join ApRez and start booking tables</Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
            <Text style={styles.label}>First Name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="John"
              placeholderTextColor={Colors.textLight}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
            <Text style={styles.label}>Last Name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Doe"
              placeholderTextColor={Colors.textLight}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="your@email.com"
            placeholderTextColor={Colors.textLight}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+40 7XX XXX XXX"
            placeholderTextColor={Colors.textLight}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Min. 6 characters"
              placeholderTextColor={Colors.textLight}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textLight} />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => {
            setError(null);
            navigation.goBack();
          }}
        >
          <Text style={styles.linkText}>
            Already have an account? <Text style={styles.linkBold}>Log in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 60 },
  header: { marginBottom: 28 },
  title: { fontSize: 30, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 15, color: Colors.textSecondary, marginTop: 4 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.errorBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: { color: Colors.error, fontSize: 14, flex: 1 },
  row: { flexDirection: 'row' },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingRight: 8,
  },
  eyeBtn: { padding: 8 },
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  linkBtn: { alignItems: 'center', marginTop: 20, marginBottom: 40 },
  linkText: { fontSize: 15, color: Colors.textSecondary },
  linkBold: { color: Colors.primary, fontWeight: '600' },
});
