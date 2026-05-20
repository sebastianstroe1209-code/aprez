import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
import api, { getErrorMessage } from '../lib/api';
import { formatDate } from '../lib/format';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { subscribe, subscribeStatus } from '../lib/socket';

const STATUS_CONFIG = {
  PENDING: { color: Colors.warning, bg: Colors.warningBg, label: 'Pending', icon: 'time-outline' },
  CONFIRMED: { color: Colors.confirmed, bg: Colors.primaryBg, label: 'Confirmed', icon: 'checkmark-circle-outline' },
  AUTO_CONFIRMED: { color: Colors.confirmed, bg: Colors.primaryBg, label: 'Confirmed', icon: 'checkmark-circle-outline' },
  CANCELLED: { color: Colors.error, bg: Colors.errorBg, label: 'Cancelled', icon: 'close-circle-outline' },
  COMPLETED: { color: Colors.completed, bg: Colors.borderLight, label: 'Completed', icon: 'checkmark-done-outline' },
  NO_SHOW: { color: Colors.error, bg: Colors.errorBg, label: 'No Show', icon: 'alert-circle-outline' },
  MODIFICATION_PENDING: { color: Colors.warning, bg: Colors.warningBg, label: 'Modification Pending', icon: 'create-outline' },
};


export default function ReservationsScreen({ navigation }) {
  const { t } = useTranslation();
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('upcoming'); // 'upcoming' or 'past'
  const [socketDisconnected, setSocketDisconnected] = useState(false);

  const loadReservations = async () => {
    try {
      const res = await api.get('/reservations/mine');
      setReservations(res.data.reservations || res.data || []);
    } catch (e) {
      console.log('Failed to load reservations:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadReservations();
    }, [])
  );

  // C4: subscribe to §5a events on the user:{id} room.
  useEffect(() => {
    let unsubUpdated = null;
    let unsubCancelled = null;
    const upsert = (r) => {
      if (!r?.id) return;
      setReservations((list) => {
        const idx = list.findIndex((x) => x.id === r.id);
        if (idx === -1) return [r, ...list];
        const next = list.slice();
        next[idx] = { ...list[idx], ...r };
        return next;
      });
    };
    const onCancelled = (payload) => {
      if (!payload?.id) return;
      setReservations((list) =>
        list.map((r) => (r.id === payload.id ? { ...r, ...payload, status: 'CANCELLED' } : r))
      );
    };
    subscribe('reservation:updated', upsert).then((u) => { unsubUpdated = u; });
    subscribe('reservation:cancelled', onCancelled).then((u) => { unsubCancelled = u; });
    return () => {
      if (unsubUpdated) unsubUpdated();
      if (unsubCancelled) unsubCancelled();
    };
  }, []);

  // Reconnect banner: surface bad-WiFi state after a 2s grace.
  useEffect(() => {
    let timer = null;
    const unsub = subscribeStatus((connected) => {
      if (connected) {
        if (timer) { clearTimeout(timer); timer = null; }
        setSocketDisconnected(false);
        loadReservations(); // §4.4 refetch on reconnect
      } else {
        if (!timer) timer = setTimeout(() => setSocketDisconnected(true), 2000);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);

  const cancelReservation = (id) => {
    Alert.alert('Cancel Reservation', 'Are you sure you want to cancel this reservation?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.put(`/reservations/${id}/cancel`);
            loadReservations();
          } catch (e) {
            Alert.alert('Error', getErrorMessage(e));
          }
        },
      },
    ]);
  };

  const now = new Date();
  const upcoming = reservations.filter((r) => {
    const d = new Date(r.date);
    return d >= new Date(now.toDateString()) && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(r.status);
  });
  const past = reservations.filter((r) => {
    const d = new Date(r.date);
    return d < new Date(now.toDateString()) || ['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(r.status);
  });

  const data = tab === 'upcoming' ? upcoming : past;

  // Tier E commit 2 — Keep/Cancel ack on a REJECTED modification.
  // Same endpoint the detail screen uses. We mutate local state
  // optimistically to clear the banner without waiting for the socket
  // round-trip; the subsequent `reservation:updated` event re-confirms.
  const [ackWorking, setAckWorking] = useState(null); // `${id}:${action}`
  const ackModification = async (reservationId, modId, action) => {
    const tag = `${reservationId}:${action}`;
    if (ackWorking) return;
    setAckWorking(tag);
    try {
      const res = await api.post(`/reservations/${reservationId}/modifications/${modId}/ack`, { action });
      setReservations((list) =>
        list.map((r) => {
          if (r.id !== reservationId) return r;
          if (action === 'cancel') {
            return { ...r, status: 'CANCELLED', modificationRejected: null, ...(res.data?.reservation || {}) };
          }
          return { ...r, modificationRejected: null };
        })
      );
    } catch (e) {
      Alert.alert('Error', getErrorMessage(e) || t('modRejected.errorGeneric'));
    } finally {
      setAckWorking(null);
    }
  };

  const renderReservation = ({ item }) => {
    const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.PENDING;
    const restaurantName = item.restaurant?.nameEn || item.restaurant?.nameRo || 'Restaurant';
    const canCancel = ['PENDING', 'CONFIRMED', 'AUTO_CONFIRMED'].includes(item.status);
    // Tier E commit 2 — show the amber Keep/Cancel banner when a
    // REJECTED modification on this reservation hasn't been acknowledged.
    const hasUnackRejected = !!(item.modificationRejected && !item.modificationRejected.acknowledgedAt);
    const ackKeepTag = `${item.id}:keep`;
    const ackCancelTag = `${item.id}:cancel`;

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.card}
        onPress={() => navigation.navigate('ReservationDetail', { reservationId: item.id })}
      >
        <View style={styles.cardTop}>
          <View style={styles.cardHeader}>
            <Text style={styles.restaurantName} numberOfLines={1}>{restaurantName}</Text>
            <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
              <Ionicons name={config.icon} size={14} color={config.color} />
              <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
            </View>
          </View>

          <View style={styles.detailsRow}>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={16} color={Colors.textSecondary} />
              <Text style={styles.detailText}>{formatDate(item.date)}</Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="time-outline" size={16} color={Colors.textSecondary} />
              <Text style={styles.detailText}>{item.time} - {item.endTime}</Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="people-outline" size={16} color={Colors.textSecondary} />
              <Text style={styles.detailText}>{item.partySize} {item.partySize === 1 ? 'guest' : 'guests'}</Text>
            </View>
          </View>
        </View>

        {/* Tier E commit 2 — inline amber Keep/Cancel banner.
            Tap-stop on the buttons so the row's onPress doesn't fire. */}
        {hasUnackRejected && (
          <View style={styles.rejectBanner}>
            <Text style={styles.rejectTitle}>{t('modRejected.bannerTitle')}</Text>
            <Text style={styles.rejectSub}>{t('modRejected.bannerSub')}</Text>
            <View style={styles.rejectBtnRow}>
              <TouchableOpacity
                style={[styles.rejectKeepBtn, ackWorking === ackKeepTag && { opacity: 0.6 }]}
                onPress={(e) => { e.stopPropagation?.(); ackModification(item.id, item.modificationRejected.id, 'keep'); }}
                disabled={!!ackWorking}
              >
                {ackWorking === ackKeepTag ? (
                  <ActivityIndicator size="small" color={Colors.warnTintText} />
                ) : (
                  <Text style={styles.rejectKeepText}>{t('modRejected.keepButton')}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rejectCancelBtnInline, ackWorking === ackCancelTag && { opacity: 0.6 }]}
                onPress={(e) => {
                  e.stopPropagation?.();
                  Alert.alert(
                    t('modRejected.cancelConfirmTitle'),
                    t('modRejected.cancelConfirmBody'),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      { text: t('modRejected.cancelButton'), style: 'destructive', onPress: () => ackModification(item.id, item.modificationRejected.id, 'cancel') },
                    ]
                  );
                }}
                disabled={!!ackWorking}
              >
                {ackWorking === ackCancelTag ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.rejectCancelTextInline}>{t('modRejected.cancelButton')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* J1d — informational pending-modification indicator. No
            actions; clears automatically when modificationPending → null
            (staff approve/reject fires reservation:updated). Rejected
            (actionable) takes precedence when somehow both are present. */}
        {item.modificationPending && !hasUnackRejected && (
          <View style={styles.pendingBanner}>
            <Ionicons name="hourglass-outline" size={16} color={Colors.warnTintText} />
            <Text style={styles.pendingBannerText}>{t('reservationDetail.pendingModNote')}</Text>
          </View>
        )}

        {canCancel && tab === 'upcoming' && !hasUnackRejected && (
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={(e) => { e.stopPropagation?.(); cancelReservation(item.id); }}
          >
            <Ionicons name="close-outline" size={16} color={Colors.error} />
            <Text style={styles.cancelText}>Cancel Reservation</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {socketDisconnected && (
        <View style={styles.reconnectBanner}>
          <Text style={styles.reconnectBannerText}>{t('reservations.reconnecting')}</Text>
        </View>
      )}
      <View style={styles.header}>
        <Text style={styles.title}>{t('reservations.title')}</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'upcoming' && styles.tabActive]}
          onPress={() => setTab('upcoming')}
        >
          <Text style={[styles.tabText, tab === 'upcoming' && styles.tabTextActive]}>
            Upcoming ({upcoming.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'past' && styles.tabActive]}
          onPress={() => setTab('past')}
        >
          <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>
            Past ({past.length})
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderReservation}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadReservations(); }} tintColor={Colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>
              {tab === 'upcoming' ? 'No upcoming reservations' : 'No past reservations'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {tab === 'upcoming' ? 'Find a restaurant and book a table!' : 'Your reservation history will appear here.'}
            </Text>
            {tab === 'upcoming' && (
              <TouchableOpacity
                style={styles.browseBtn}
                onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
              >
                <Text style={styles.browseBtnText}>Browse Restaurants</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reconnectBanner: { backgroundColor: Colors.warnTint, borderBottomWidth: 1, borderBottomColor: Colors.warnTintBorderSoft, paddingVertical: 6, alignItems: 'center' },
  reconnectBannerText: { color: Colors.warnTintText, fontSize: 13, fontWeight: '600' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: Colors.borderLight,
    borderRadius: 10,
    padding: 3,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.text },
  listContent: { padding: 20, paddingTop: 8 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardTop: { padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  restaurantName: { fontSize: 17, fontWeight: '700', color: Colors.text, flex: 1, marginRight: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '600' },
  detailsRow: { gap: 8 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontSize: 14, color: Colors.textSecondary },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.error },
  // Tier E commit 2 — inline reject banner styles. Amber tones to
  // match the restaurant popup's modification callout.
  rejectBanner: {
    marginTop: 8, marginHorizontal: 0,
    backgroundColor: Colors.warnTint, borderColor: Colors.warnTintBorder, borderWidth: 1,
    borderRadius: 10, padding: 12,
  },
  rejectTitle: { fontSize: 14, fontWeight: '700', color: Colors.warnTintText },
  rejectSub: { fontSize: 13, color: Colors.warnTintText, marginTop: 2, marginBottom: 10 },
  // J1d — informational pending-modification banner (no action buttons).
  pendingBanner: {
    marginTop: 8,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.warnTint, borderColor: Colors.warnTintBorder, borderWidth: 1,
    borderRadius: 10, padding: 12,
  },
  pendingBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.warnTintText },
  rejectBtnRow: { flexDirection: 'row', gap: 8 },
  rejectKeepBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.warnTintText, backgroundColor: '#fff', alignItems: 'center',
  },
  rejectKeepText: { color: Colors.warnTintText, fontWeight: '700', fontSize: 13 },
  rejectCancelBtnInline: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.error, alignItems: 'center',
  },
  rejectCancelTextInline: { color: '#fff', fontWeight: '700', fontSize: 13 },
  emptyState: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSecondary, marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: Colors.textLight, marginTop: 4, textAlign: 'center' },
  browseBtn: {
    marginTop: 20,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  browseBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
