import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../lib/colors';
import { useAuth } from '../contexts/AuthContext';
import { setLocale as setI18nLocale, getCurrentLocale } from '../lib/i18n';

export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const { user, logout, updateProfile, deleteAccount, error, setError } = useAuth();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // K5 — password re-auth before deletion.
  const [deletePassword, setDeletePassword] = useState('');

  const handleDelete = async () => {
    if (deleting) return;
    setDeleteError('');
    if (!deletePassword) {
      setDeleteError(t('deleteAccount.passwordRequired'));
      return;
    }
    setDeleting(true);
    const result = await deleteAccount(deletePassword);
    setDeleting(false);
    if (!result?.ok) {
      // K5 — map the server's structured code to localized copy.
      // 'password-required' shouldn't fire (we gate locally above), but
      // handle it defensively. 'password-incorrect' is the common case
      // when the diner types the wrong password.
      const code = result?.code;
      if (code === 'password-required') setDeleteError(t('deleteAccount.passwordRequired'));
      else if (code === 'password-incorrect') setDeleteError(t('deleteAccount.passwordIncorrect'));
      else setDeleteError(t('deleteAccount.errorGeneric'));
      return;
    }
    // On success the AuthContext sets user=null and AppNavigator bounces
    // to the AuthStack automatically. No explicit navigation needed; the
    // modal unmounts with the screen.
  };
  const currentLocale = i18n.language || getCurrentLocale();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const success = await updateProfile({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim() || undefined,
    });
    setSaving(false);
    if (success) {
      setEditing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('profile.title')}</Text>

      {/* Avatar */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.firstName?.[0] || '').toUpperCase()}
            {(user?.lastName?.[0] || '').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.userName}>
          {user?.firstName} {user?.lastName}
        </Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
      </View>

      {/* Profile Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Personal Information</Text>
          {!editing && (
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Ionicons name="create-outline" size={20} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>First Name</Text>
          {editing ? (
            <TextInput
              style={styles.fieldInput}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
            />
          ) : (
            <Text style={styles.fieldValue}>{user?.firstName}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Last Name</Text>
          {editing ? (
            <TextInput
              style={styles.fieldInput}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
            />
          ) : (
            <Text style={styles.fieldValue}>{user?.lastName}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Email</Text>
          <Text style={styles.fieldValue}>{user?.email}</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Phone</Text>
          {editing ? (
            <TextInput
              style={styles.fieldInput}
              value={phone}
              onChangeText={setPhone}
              placeholder="+40 7XX XXX XXX"
              keyboardType="phone-pad"
            />
          ) : (
            <Text style={styles.fieldValue}>{user?.phone || 'Not set'}</Text>
          )}
        </View>

        {editing && (
          <View style={styles.editButtons}>
            <TouchableOpacity
              style={styles.cancelEditBtn}
              onPress={() => {
                setEditing(false);
                setFirstName(user?.firstName || '');
                setLastName(user?.lastName || '');
                setPhone(user?.phone || '');
                setError(null);
              }}
            >
              <Text style={styles.cancelEditText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.7 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Settings */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Settings</Text>

        <TouchableOpacity style={styles.settingRow}>
          <Ionicons name="notifications-outline" size={20} color={Colors.text} />
          <Text style={styles.settingText}>Notifications</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
        </TouchableOpacity>

        {/* Language toggle (C5 scaffold) — replaces the placeholder row. */}
        <View style={styles.langSection}>
          <View style={styles.settingRow}>
            <Ionicons name="language-outline" size={20} color={Colors.text} />
            <Text style={styles.settingText}>{t('profile.languageSectionTitle')}</Text>
          </View>
          <Text style={styles.langHint}>{t('profile.languageSectionHint')}</Text>
          <View style={styles.langButtons}>
            {['ro', 'en'].map((code) => (
              <TouchableOpacity
                key={code}
                style={[
                  styles.langButton,
                  currentLocale === code && styles.langButtonActive,
                ]}
                onPress={() => setI18nLocale(code)}
              >
                <Text style={[
                  styles.langButtonText,
                  currentLocale === code && styles.langButtonTextActive,
                ]}>{code.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.settingRow}>
          <Ionicons name="shield-checkmark-outline" size={20} color={Colors.text} />
          <Text style={styles.settingText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.settingRow}>
          <Ionicons name="document-text-outline" size={20} color={Colors.text} />
          <Text style={styles.settingText}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color={Colors.error} />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      {/* Danger zone — GDPR §5.9 account deletion. */}
      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>{t('deleteAccount.sectionTitle')}</Text>
        <Text style={styles.dangerHint}>{t('deleteAccount.sectionHint')}</Text>
        <TouchableOpacity
          style={styles.dangerBtn}
          onPress={() => {
            setDeleteError('');
            setDeletePassword('');
            setShowDeleteModal(true);
          }}
        >
          <Ionicons name="trash-outline" size={18} color={Colors.error} />
          <Text style={styles.dangerBtnText}>{t('deleteAccount.button')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>ApRez v1.0.0</Text>
    </ScrollView>

    {/* Account-deletion confirmation modal. */}
    <Modal
      visible={showDeleteModal}
      animationType="fade"
      transparent
      onRequestClose={() => {
        if (deleting) return;
        setShowDeleteModal(false);
        setDeletePassword('');
        setDeleteError('');
      }}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalIconWrap}>
            <Ionicons name="warning-outline" size={28} color={Colors.error} />
          </View>
          <Text style={styles.modalTitle}>{t('deleteAccount.confirmTitle')}</Text>
          <Text style={styles.modalBody}>{t('deleteAccount.confirmBody')}</Text>
          {/* K5 — inline password confirmation. */}
          <Text style={styles.modalPasswordLabel}>{t('deleteAccount.passwordLabel')}</Text>
          <TextInput
            style={styles.modalPasswordInput}
            value={deletePassword}
            onChangeText={(v) => { setDeletePassword(v); if (deleteError) setDeleteError(''); }}
            placeholder={t('deleteAccount.passwordPlaceholder')}
            placeholderTextColor={Colors.textLight}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!deleting}
          />
          {deleteError ? (
            <Text style={styles.modalError}>{deleteError}</Text>
          ) : null}
          <View style={styles.modalBtnRow}>
            <TouchableOpacity
              style={[styles.modalCancelBtn, deleting && { opacity: 0.5 }]}
              onPress={() => {
                if (deleting) return;
                setShowDeleteModal(false);
                setDeletePassword('');
                setDeleteError('');
              }}
              disabled={deleting}
            >
              <Text style={styles.modalCancelText}>{t('deleteAccount.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalDeleteBtn, deleting && { opacity: 0.7 }]}
              onPress={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.modalDeleteText}>{t('deleteAccount.confirmAction')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, marginBottom: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
  userName: { fontSize: 20, fontWeight: '700', color: Colors.text },
  userEmail: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  errorBox: { backgroundColor: Colors.errorBg, padding: 10, borderRadius: 8, marginBottom: 12 },
  errorText: { color: Colors.error, fontSize: 13 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  fieldValue: { fontSize: 15, color: Colors.text },
  fieldInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
  },
  editButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelEditBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  cancelEditText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  saveBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: Colors.primary },
  saveBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 12,
  },
  settingText: { flex: 1, fontSize: 15, color: Colors.text },
  settingValue: { fontSize: 14, color: Colors.textSecondary },
  langSection: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight, paddingBottom: 12 },
  langHint: { fontSize: 12, color: Colors.textSecondary, paddingHorizontal: 32, paddingBottom: 8 },
  langButtons: { flexDirection: 'row', gap: 8, paddingHorizontal: 32, paddingBottom: 4 },
  langButton: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: Colors.borderLight, minWidth: 60, alignItems: 'center' },
  langButtonActive: { backgroundColor: Colors.primary },
  langButtonText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  langButtonTextActive: { color: '#fff' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.errorBg,
    marginTop: 4,
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: Colors.error },
  version: { textAlign: 'center', fontSize: 13, color: Colors.textLight, marginTop: 20 },
  // Danger zone
  dangerCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.errorBg,
    backgroundColor: Colors.surface,
  },
  dangerTitle: { fontSize: 15, fontWeight: '700', color: Colors.error, marginBottom: 4 },
  dangerHint: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  dangerBtnText: { fontSize: 14, fontWeight: '600', color: Colors.error },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  modalIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.errorBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  modalBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  // K5 — password re-auth input inside the confirm modal.
  modalPasswordLabel: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  modalPasswordInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 12,
  },
  modalError: { fontSize: 13, color: Colors.error, marginBottom: 12, textAlign: 'center' },
  modalBtnRow: { flexDirection: 'row', gap: 10, width: '100%' },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  modalDeleteBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.error,
    alignItems: 'center',
  },
  modalDeleteText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
