// Tier E commit 2 — Request a change form. Opens from
// ReservationDetailScreen for an active reservation (no pending mod, no
// unacked rejection). Submits to POST /api/reservations/:id/modify with
// only the changed fields (matches the backend's "must differ"
// semantics from Tier E commit 1).
//
// Backend-side validation:
//   - reservation-not-modifiable (status COMPLETED/NO_SHOW/CANCELLED)
//   - modification-already-pending (with existingId)
//   - no-op-modification (empty body or every requested field matches current)
//   - date-in-past (effective date < today Bucharest)
//   - date-not-available (effective date on the restaurant's disabled list)
//   - time-outside-hours (effective time outside opening hours for the
//     effective date's weekday)
// All surface here as localized inline errors.

import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../lib/colors';
import api, { getErrorMessage } from '../lib/api';
import { formatDate } from '../lib/format';

function generateDates(count = 30) {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateLabel(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

const TIME_SLOTS = (() => {
  // 18:00 → 22:30 in 30-min steps. The actual valid slots come back
  // from the server as 400 time-outside-hours if the diner picks
  // something out of range — so this is just a sensible default UI
  // grid, not authoritative.
  const arr = [];
  for (let h = 11; h <= 22; h++) {
    for (let m of [0, 30]) arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return arr;
})();

export default function RequestChangeScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { reservation } = route.params || {};
  const rid = reservation?.id;
  const restaurantId = reservation?.restaurantId;

  // Source the current values from the navigation param. Date arrives
  // as an ISO string; reduce to YYYY-MM-DD for the comparison helpers.
  const currentDateIso = reservation?.date
    ? (typeof reservation.date === 'string' ? reservation.date.slice(0, 10) : isoDate(new Date(reservation.date)))
    : null;
  const currentTime = reservation?.time;
  const currentParty = reservation?.partySize;

  const [date, setDate] = useState(currentDateIso);
  const [time, setTime] = useState(currentTime);
  const [partySize, setPartySize] = useState(currentParty);
  const [disabledDates, setDisabledDates] = useState({}); // ISO → reason
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Fetch disabled-date list so the picker can gray out matching dates,
  // mirroring the BookReservationScreen UX from Tier F2.
  useEffect(() => {
    if (!restaurantId) return;
    let alive = true;
    api.get(`/restaurants/${restaurantId}/disabled-dates`)
      .then((res) => {
        if (!alive) return;
        const map = {};
        for (const row of res.data || []) {
          const iso = (row.date || '').slice(0, 10);
          if (iso) map[iso] = row.reason || null;
        }
        setDisabledDates(map);
      })
      .catch(() => { /* non-blocking — server still enforces */ });
    return () => { alive = false; };
  }, [restaurantId]);

  const dates = useMemo(() => generateDates(30), []);
  const hasChange = date !== currentDateIso || time !== currentTime || partySize !== currentParty;
  const canSubmit = !submitting && hasChange;

  const localizedError = (raw) => {
    // Map known backend error.code strings to i18n keys. The api helper
    // surfaces err.response.data.error which may be a string or
    // { code, message }.
    const code = raw?.response?.data?.error?.code;
    if (code === 'modification-already-pending') return t('errors.modificationAlreadyPending');
    if (code === 'no-op-modification') return t('errors.noOpModification');
    if (code === 'reservation-not-modifiable') return t('errors.reservationNotModifiable');
    if (code === 'date-not-available') return t('errors.dateNotAvailable');
    if (code === 'date-in-past') return t('errors.dateInPast');
    if (code === 'time-outside-hours') return t('errors.timeOutsideHours');
    return getErrorMessage(raw) || t('errors.generic');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      const body = {};
      if (date !== currentDateIso) body.requestedDate = date;
      if (time !== currentTime) body.requestedTime = time;
      if (partySize !== currentParty) body.requestedPartySize = partySize;
      await api.post(`/reservations/${rid}/modify`, body);
      setSubmitted(true);
    } catch (e) {
      setError(localizedError(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <View style={{ width: 28 }} />
          <Text style={styles.headerTitle}>{t('modify.pendingTitle')}</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centered}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color={Colors.primary} />
          </View>
          <Text style={styles.successTitle}>{t('modify.pendingTitle')}</Text>
          <Text style={styles.successBody}>{t('modify.pendingBody')}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('MainTabs', { screen: 'Reservations' })}
          >
            <Text style={styles.primaryBtnText}>{t('modify.pendingDone')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('modify.title')}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subtitle}>{t('modify.subtitle')}</Text>

        {/* Date */}
        <Text style={styles.fieldLabel}>{t('modify.dateField')}</Text>
        <Text style={styles.currentLine}>{t('modify.currentLabel', { value: formatDate(currentDateIso) })}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScroll}>
          {dates.map((d) => {
            const iso = isoDate(d);
            const isSelected = iso === date;
            const isDisabled = Object.prototype.hasOwnProperty.call(disabledDates, iso);
            return (
              <TouchableOpacity
                key={iso}
                onPress={() => {
                  if (isDisabled) {
                    Alert.alert('Closed', disabledDates[iso] || t('errors.dateNotAvailable'));
                    return;
                  }
                  setDate(iso);
                }}
                style={[
                  styles.dateCard,
                  isSelected && !isDisabled && styles.dateCardActive,
                  isDisabled && styles.dateCardDisabled,
                ]}
              >
                <Text style={[styles.dateLabelText, isSelected && !isDisabled && styles.dateLabelTextActive, isDisabled && styles.dateTextDisabled]}>
                  {dateLabel(d)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Time */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>{t('modify.timeField')}</Text>
        <Text style={styles.currentLine}>{t('modify.currentLabel', { value: currentTime })}</Text>
        <View style={styles.timeGrid}>
          {TIME_SLOTS.map((slot) => {
            const isSelected = slot === time;
            return (
              <TouchableOpacity
                key={slot}
                onPress={() => setTime(slot)}
                style={[styles.timeChip, isSelected && styles.timeChipActive]}
              >
                <Text style={[styles.timeChipText, isSelected && styles.timeChipTextActive]}>{slot}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Party */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>{t('modify.partyField')}</Text>
        <Text style={styles.currentLine}>{t('modify.currentLabel', { value: String(currentParty) })}</Text>
        <View style={styles.partyRow}>
          <TouchableOpacity
            style={styles.partyBtn}
            onPress={() => setPartySize(Math.max(1, partySize - 1))}
          >
            <Ionicons name="remove" size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.partyDisplay}>
            <Ionicons name="people" size={22} color={Colors.primary} />
            <Text style={styles.partyNumber}>{partySize}</Text>
          </View>
          <TouchableOpacity
            style={styles.partyBtn}
            onPress={() => setPartySize(Math.min(30, partySize + 1))}
          >
            <Ionicons name="add" size={24} color={Colors.text} />
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{hasChange ? t('modify.submitButton') : t('modify.disabledSubmit')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  body: { padding: 20, paddingBottom: 120 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 20, lineHeight: 20 },
  fieldLabel: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  currentLine: { fontSize: 12, color: Colors.textSecondary, marginBottom: 8 },
  dateScroll: {},
  dateCard: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, marginRight: 8,
  },
  dateCardActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dateCardDisabled: { backgroundColor: Colors.borderLight, borderColor: Colors.borderLight, opacity: 0.7 },
  dateLabelText: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  dateLabelTextActive: { color: '#fff' },
  dateTextDisabled: { color: Colors.textLight, textDecorationLine: 'line-through' },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  timeChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  timeChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  timeChipText: { fontSize: 14, color: Colors.text, fontWeight: '600' },
  timeChipTextActive: { color: '#fff' },
  partyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginTop: 4 },
  partyBtn: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  partyDisplay: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 80, justifyContent: 'center' },
  partyNumber: { fontSize: 28, fontWeight: '800', color: Colors.text },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.errorBg, padding: 12, borderRadius: 10, marginTop: 16,
  },
  errorText: { flex: 1, color: Colors.error, fontSize: 13 },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 28,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: Colors.primary,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon: { marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  successBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
});
