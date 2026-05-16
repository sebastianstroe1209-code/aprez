// Tier D commit 2 — Diner reset-password screen. Receives the token via
// the React Navigation deep-link integration (aprez://reset-password?token=…)
// — token shows up in route.params.token. Surfaces backend error codes
// (invalid-token / token-used / token-expired) as specific i18n copy so the
// diner knows whether to request a new link or use the one they have.

import React, { useEffect, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { Colors } from '../lib/colors';
import api from '../lib/api';

export default function ResetPasswordScreen({ route, navigation }) {
  const { t } = useTranslation();
  const token = route?.params?.token || '';
  const missingToken = !token;

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // After a successful submit, bounce back to Login after a beat so the
  // diner can sign in with the new password. No auto-login — they should
  // confirm the new password works by typing it.
  useEffect(() => {
    if (!submitted) return;
    const id = setTimeout(() => navigation.navigate('Login'), 2200);
    return () => clearTimeout(id);
  }, [submitted, navigation]);

  const handleSubmit = async () => {
    if (submitting) return;
    setError('');
    if (newPassword.length < 6) {
      setError(t('reset.errorMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('reset.errorMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/diner/reset-password', { token, newPassword });
      setSubmitted(true);
    } catch (e) {
      const code = e?.response?.data?.error?.code;
      const message =
        code === 'token-expired' ? t('reset.errorTokenExpired') :
        code === 'token-used'    ? t('reset.errorTokenUsed') :
        code === 'invalid-token' ? t('reset.errorInvalidToken') :
        (e?.response?.data?.error?.message || t('reset.errorGeneric'));
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{t('reset.title')}</Text>
        <Text style={styles.subtitle}>{t('reset.subtitle')}</Text>

        {missingToken ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={Colors.error} />
            <Text style={styles.errorText}>{t('reset.errorMissingToken')}</Text>
          </View>
        ) : submitted ? (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={22} color={Colors.success || Colors.primary} />
            <Text style={styles.successText}>{t('reset.success')}</Text>
          </View>
        ) : (
          <>
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color={Colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('reset.newPassword')}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color={Colors.textLight} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="••••••"
                  placeholderTextColor={Colors.textLight}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!submitting}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textLight} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('reset.confirmPassword')}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color={Colors.textLight} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="••••••"
                  placeholderTextColor={Colors.textLight}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  editable={!submitting}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                (submitting || !newPassword || !confirmPassword) && styles.buttonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={submitting || !newPassword || !confirmPassword}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t('reset.submit')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.linkText}>{t('forgot.backToLogin')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, padding: 24, paddingTop: Platform.OS === 'ios' ? 60 : 32 },
  headerRow: { flexDirection: 'row', marginBottom: 16 },
  backBtn: { padding: 4 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, marginBottom: 24, lineHeight: 22 },
  successBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.primaryBg,
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  successText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.errorBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: { color: Colors.error, fontSize: 14, flex: 1 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 14, fontSize: 16, color: Colors.text },
  eyeBtn: { padding: 4 },
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  linkBtn: { alignItems: 'center', marginTop: 28 },
  linkText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
});
