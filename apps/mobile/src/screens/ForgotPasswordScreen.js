// Tier D commit 2 — Diner forgot-password entry. Mirror of the restaurant
// web flow at /apps/restaurant/app/forgot-password but for the Expo app.
// Posts to /api/auth/diner/forgot-password which always returns a neutral
// 200, so the success screen here is shown regardless of whether the
// email matched a real account (prevents account enumeration).

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
import { useTranslation } from 'react-i18next';
import { Colors } from '../lib/colors';
import api, { getErrorMessage } from '../lib/api';

export default function ForgotPasswordScreen({ navigation }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (submitting) return;
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError(t('forgot.errorMissingEmail'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/diner/forgot-password', { email: trimmed });
      setSubmitted(true);
    } catch (e) {
      // Per spec the server always returns 200 for this endpoint, so we
      // only land here on a network failure or validation rejection.
      setError(getErrorMessage(e) || t('forgot.errorGeneric'));
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
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{t('forgot.title')}</Text>
        <Text style={styles.subtitle}>{t('forgot.subtitle')}</Text>

        {submitted ? (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={22} color={Colors.success || Colors.primary} />
            <Text style={styles.successText}>{t('forgot.success')}</Text>
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
              <Text style={styles.label}>{t('forgot.emailLabel')}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color={Colors.textLight} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('forgot.emailPlaceholder')}
                  placeholderTextColor={Colors.textLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  editable={!submitting}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.button, (submitting || !email.trim()) && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting || !email.trim()}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t('forgot.submit')}</Text>
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
    alignItems: 'center',
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
