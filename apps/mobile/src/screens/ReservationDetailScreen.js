// Tier E commit 2 — per-reservation drill-down. Reached from
// ReservationsScreen card taps. Renders status / date / time / party /
// table / special requests, and exposes Request a change + Cancel
// reservation actions when status allows. If the row carries an
// unacknowledged modificationRejected, the same amber Keep/Cancel
// banner that lives on ReservationsScreen renders here too.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Image,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../lib/colors';
import api, { getErrorMessage, mediaUrl } from '../lib/api';
import { formatDate } from '../lib/format';
import { subscribe } from '../lib/socket';

// Mirror the colors used by the list — see ReservationsScreen STATUS_CONFIG.
// Kept local so this screen doesn't import the list's whole module just
// for a label/icon mapping.
const STATUS_CONFIG = {
  PENDING: { color: Colors.warning, bg: Colors.warningBg, icon: 'time-outline' },
  CONFIRMED: { color: Colors.confirmed, bg: Colors.primaryBg, icon: 'checkmark-circle-outline' },
  AUTO_CONFIRMED: { color: Colors.confirmed, bg: Colors.primaryBg, icon: 'checkmark-circle-outline' },
  CANCELLED: { color: Colors.error, bg: Colors.errorBg, icon: 'close-circle-outline' },
  COMPLETED: { color: Colors.completed, bg: '#f1f5f9', icon: 'checkmark-done-outline' },
  NO_SHOW: { color: Colors.error, bg: Colors.errorBg, icon: 'alert-circle-outline' },
  MODIFICATION_PENDING: { color: Colors.warning, bg: Colors.warningBg, icon: 'create-outline' },
};

export default function ReservationDetailScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { reservationId } = route.params || {};
  const [reservation, setReservation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [ackWorking, setAckWorking] = useState(null); // 'keep' | 'cancel' | null
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRejectCancelModal, setShowRejectCancelModal] = useState(false);

  const load = useCallback(async () => {
    if (!reservationId) return;
    try {
      const res = await api.get(`/reservations/${reservationId}`);
      setReservation(res.data);
      setError('');
    } catch (e) {
      setError(t('reservationDetail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [reservationId, t]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live socket sync — keep the screen current if the staff approves /
  // rejects / edits while the diner has the detail open.
  useEffect(() => {
    if (!reservationId) return;
    const onUpdate = (payload) => {
      if (payload?.id !== reservationId) return;
      // Re-fetch is cheaper to reason about than merging the partial
      // socket payload into local state — payload shapes vary across
      // emit sites (reservation:updated carries different field subsets
      // from different routes; see server/src/socket/events.md).
      load();
    };
    const onCancelled = (payload) => {
      if (payload?.id !== reservationId) return;
      load();
    };
    let unsubU = null; let unsubC = null;
    subscribe('reservation:updated', onUpdate).then((u) => { unsubU = u; });
    subscribe('reservation:cancelled', onCancelled).then((u) => { unsubC = u; });
    return () => { if (unsubU) unsubU(); if (unsubC) unsubC(); };
  }, [reservationId, load]);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await api.put(`/reservations/${reservationId}/cancel`);
      setShowCancelModal(false);
      // Live socket will re-load, but force one for immediate feedback.
      load();
    } catch (e) {
      Alert.alert('Error', getErrorMessage(e) || t('modRejected.errorGeneric'));
    } finally {
      setCancelling(false);
    }
  };

  // Tier E commit 2 — Keep/Cancel ack on a REJECTED modification.
  const handleAck = async (action) => {
    if (ackWorking || !reservation?.modificationRejected?.id) return;
    setAckWorking(action);
    try {
      await api.post(
        `/reservations/${reservationId}/modifications/${reservation.modificationRejected.id}/ack`,
        { action }
      );
      setShowRejectCancelModal(false);
      load();
    } catch (e) {
      Alert.alert('Error', getErrorMessage(e) || t('modRejected.errorGeneric'));
    } finally {
      setAckWorking(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }
  if (error || !reservation) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text style={styles.errorText}>{error || t('reservationDetail.loadError')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const r = reservation;
  const status = r.status;
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const restaurantName = r.restaurant?.nameEn || r.restaurant?.nameRo || '';
  const tableLabel = r.table?.tableNumber || null;
  const canChange =
    ['PENDING', 'CONFIRMED', 'AUTO_CONFIRMED'].includes(status) &&
    !r.modificationPending &&
    !r.modificationRejected;
  const canCancel = ['PENDING', 'CONFIRMED', 'AUTO_CONFIRMED'].includes(status);
  const hasRejected = !!r.modificationRejected;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('reservationDetail.title')}</Text>
          <View style={{ width: 28 }} />
        </View>

        {r.restaurant?.coverPhotoUrl ? (
          <Image source={{ uri: mediaUrl(r.restaurant.coverPhotoUrl) }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Ionicons name="restaurant" size={48} color={Colors.primaryLight} />
          </View>
        )}

        <View style={styles.body}>
          <Text style={styles.restaurantName}>{restaurantName}</Text>

          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Ionicons name={statusConfig.icon} size={16} color={statusConfig.color} />
            <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>
              {t(`reservationDetail.statusLabel`)}: {status.replace(/_/g, ' ')}
            </Text>
          </View>

          {/* Reject banner — same UX as the inline card banner on
              ReservationsScreen but rendered as a card here too so the
              diner can act without bouncing back to the list. */}
          {hasRejected && (
            <View style={styles.rejectBanner}>
              <Text style={styles.rejectTitle}>{t('modRejected.bannerTitle')}</Text>
              <Text style={styles.rejectSub}>{t('modRejected.bannerSub')}</Text>
              <View style={styles.rejectBtnRow}>
                <TouchableOpacity
                  style={[styles.keepBtn, ackWorking && { opacity: 0.6 }]}
                  onPress={() => handleAck('keep')}
                  disabled={!!ackWorking}
                >
                  {ackWorking === 'keep' ? (
                    <ActivityIndicator size="small" color={Colors.text} />
                  ) : (
                    <Text style={styles.keepBtnText}>{t('modRejected.keepButton')}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rejectCancelBtn, ackWorking && { opacity: 0.6 }]}
                  onPress={() => setShowRejectCancelModal(true)}
                  disabled={!!ackWorking}
                >
                  <Text style={styles.rejectCancelBtnText}>{t('modRejected.cancelButton')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Pending modification note — purely informational. */}
          {r.modificationPending && (
            <View style={styles.pendingNote}>
              <Ionicons name="hourglass-outline" size={18} color={Colors.warning} />
              <Text style={styles.pendingNoteText}>{t('reservationDetail.pendingModNote')}</Text>
            </View>
          )}

          {/* Fields */}
          <View style={styles.fieldGrid}>
            <View style={styles.fieldItem}>
              <Text style={styles.fieldLabel}>{t('reservationDetail.dateLabel')}</Text>
              <Text style={styles.fieldValue}>{formatDate(r.date)}</Text>
            </View>
            <View style={styles.fieldItem}>
              <Text style={styles.fieldLabel}>{t('reservationDetail.timeLabel')}</Text>
              <Text style={styles.fieldValue}>{r.time}</Text>
            </View>
            <View style={styles.fieldItem}>
              <Text style={styles.fieldLabel}>{t('reservationDetail.partyLabel')}</Text>
              <Text style={styles.fieldValue}>{r.partySize}</Text>
            </View>
            <View style={styles.fieldItem}>
              <Text style={styles.fieldLabel}>{t('reservationDetail.tableLabel')}</Text>
              <Text style={styles.fieldValue}>{tableLabel || t('reservationDetail.unassignedTable')}</Text>
            </View>
          </View>

          {r.specialRequests ? (
            <View style={styles.specialBlock}>
              <Text style={styles.fieldLabel}>{t('reservationDetail.specialRequests')}</Text>
              <Text style={styles.specialText}>{r.specialRequests}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Action bar */}
      {(canChange || canCancel) && (
        <View style={styles.actionBar}>
          {canChange && (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('RequestChange', { reservation: r })}
            >
              <Ionicons name="create-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>{t('reservationDetail.requestChange')}</Text>
            </TouchableOpacity>
          )}
          {canCancel && (
            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={() => setShowCancelModal(true)}
            >
              <Ionicons name="trash-outline" size={18} color={Colors.error} />
              <Text style={styles.dangerBtnText}>{t('reservationDetail.cancelReservation')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Cancel-reservation confirmation modal */}
      <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => !cancelling && setShowCancelModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('reservationDetail.cancelConfirmTitle')}</Text>
            <Text style={styles.modalBody}>{t('reservationDetail.cancelConfirmBody')}</Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, cancelling && { opacity: 0.5 }]}
                onPress={() => { if (!cancelling) setShowCancelModal(false); }}
                disabled={cancelling}
              >
                <Text style={styles.modalCancelText}>{t('reservationDetail.cancelReservation') ? 'Back' : ''}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDeleteBtn, cancelling && { opacity: 0.7 }]}
                onPress={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={styles.modalDeleteText}>{t('reservationDetail.cancelReservation')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reject-banner cancel confirmation */}
      <Modal visible={showRejectCancelModal} transparent animationType="fade" onRequestClose={() => !ackWorking && setShowRejectCancelModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('modRejected.cancelConfirmTitle')}</Text>
            <Text style={styles.modalBody}>{t('modRejected.cancelConfirmBody')}</Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, ackWorking && { opacity: 0.5 }]}
                onPress={() => { if (!ackWorking) setShowRejectCancelModal(false); }}
                disabled={!!ackWorking}
              >
                <Text style={styles.modalCancelText}>{t('modRejected.keepButton')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDeleteBtn, ackWorking && { opacity: 0.7 }]}
                onPress={() => handleAck('cancel')}
                disabled={!!ackWorking}
              >
                {ackWorking === 'cancel' ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={styles.modalDeleteText}>{t('modRejected.cancelButton')}</Text>
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
  scrollContent: { paddingBottom: 120 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: Colors.error, fontSize: 15, marginTop: 12, textAlign: 'center' },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  cover: { width: '100%', height: 180 },
  coverPlaceholder: { backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20 },
  restaurantName: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 12 },
  statusBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 16,
  },
  statusBadgeText: { fontSize: 13, fontWeight: '700' },
  rejectBanner: {
    backgroundColor: '#fef3c7', borderColor: '#fcd34d', borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 16,
  },
  rejectTitle: { fontSize: 15, fontWeight: '700', color: '#78350f', marginBottom: 2 },
  rejectSub: { fontSize: 14, color: '#78350f', marginBottom: 10 },
  rejectBtnRow: { flexDirection: 'row', gap: 10 },
  keepBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#78350f',
    backgroundColor: '#fff', alignItems: 'center',
  },
  keepBtnText: { color: '#78350f', fontWeight: '700', fontSize: 14 },
  rejectCancelBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: Colors.error, alignItems: 'center',
  },
  rejectCancelBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pendingNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.warningBg, borderRadius: 10, padding: 12, marginBottom: 16,
  },
  pendingNoteText: { flex: 1, color: Colors.text, fontSize: 13 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 },
  fieldItem: { width: '50%', paddingHorizontal: 8, marginBottom: 14 },
  fieldLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600', marginBottom: 4 },
  fieldValue: { fontSize: 16, color: Colors.text, fontWeight: '600' },
  specialBlock: { marginTop: 6 },
  specialText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 28,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: Colors.primary,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dangerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: Colors.error,
  },
  dangerBtnText: { color: Colors.error, fontWeight: '700', fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 360, backgroundColor: Colors.surface, borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  modalBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  modalBtnRow: { flexDirection: 'row', gap: 10, width: '100%' },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  modalDeleteBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.error, alignItems: 'center' },
  modalDeleteText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
