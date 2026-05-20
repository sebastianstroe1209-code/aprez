import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../lib/colors';
import api, { getErrorMessage } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

function generateDates(count = 14) {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function formatDate(d) {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function formatDateLabel(d) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (formatDate(d) === formatDate(today)) return 'Today';
  if (formatDate(d) === formatDate(tomorrow)) return 'Tomorrow';

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

export default function BookReservationScreen({ route, navigation }) {
  const { restaurant } = route.params;
  const r = restaurant;
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();

  const dates = useMemo(() => generateDates(14), []);

  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [selectedTime, setSelectedTime] = useState(null);
  const [partySize, setPartySize] = useState(2);
  // §5.3 — optional diner free-text note (anniversary, allergies, access needs).
  const [specialRequests, setSpecialRequests] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Step 4 is the post-booking confirmation (D2). Earlier this was an
  // Alert.alert; we promoted it to a real screen step so the optional
  // phone-collection prompt can render inline below the success message
  // for users whose User.phone is null.
  const [step, setStep] = useState(1); // 1=date, 2=time, 3=confirm, 4=success
  const [bookedStatus, setBookedStatus] = useState(null);
  const [timeSlots, setTimeSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState('');

  // Phone prompt local state. Lives in this screen rather than in
  // AuthContext because it's scoped to this single confirmation.
  const [phoneInput, setPhoneInput] = useState('');
  const [phonePromptError, setPhonePromptError] = useState('');
  const [phonePromptSaving, setPhonePromptSaving] = useState(false);
  const [phonePromptDismissed, setPhonePromptDismissed] = useState(false);

  // Tier F2 — disabled-date list for graying out the date picker.
  // Server-side enforcement is already in place (time-slots returns
  // { disabled: true } and POST /reservations 400s), so the client-side
  // gray-out is pure UX polish.
  const [disabledDates, setDisabledDates] = useState({}); // { 'YYYY-MM-DD': 'reason' | null }
  useEffect(() => {
    let alive = true;
    api.get(`/restaurants/${r.id}/disabled-dates`)
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
  }, [r.id]);

  // Phone prompt shows when: booking succeeded, user has no phone on
  // file, the server-side phonePromptSeenAt is null (so this is the
  // first qualifying reservation), and they haven't tapped Skip/Save
  // within this confirmation already.
  const shouldShowPhonePrompt =
    step === 4 &&
    !!user &&
    !user.phone &&
    !user.phonePromptSeenAt &&
    !phonePromptDismissed;

  // POST the dismissal up to the server so the prompt doesn't re-appear
  // after the user closes and re-opens the app. Fire-and-forget; we
  // tolerate a network failure here because the local dismissedFlag
  // already hides the prompt for this session.
  const stampPromptDismissed = useCallback(async () => {
    try {
      await api.post('/users/me/phone-prompt-seen');
      refreshUser?.();
    } catch (_) {
      /* silent — local state already dismissed */
    }
  }, [refreshUser]);

  const handleSkipPhone = () => {
    setPhonePromptDismissed(true);
    stampPromptDismissed();
  };

  const handleSavePhone = async () => {
    if (phonePromptSaving) return;
    const trimmed = phoneInput.trim();
    if (!/^\+40\d{9}$/.test(trimmed)) {
      setPhonePromptError(t('phonePrompt.errorFormat'));
      return;
    }
    setPhonePromptError('');
    setPhonePromptSaving(true);
    try {
      await api.put('/users/me', { phone: trimmed });
      setPhonePromptDismissed(true);
      stampPromptDismissed();
      refreshUser?.();
    } catch (e) {
      setPhonePromptError(getErrorMessage(e) || t('phonePrompt.errorFormat'));
    } finally {
      setPhonePromptSaving(false);
    }
  };

  // Fetch available time slots from server when date or party size changes
  const fetchTimeSlots = useCallback(async () => {
    setLoadingSlots(true);
    setSlotsError('');
    setSelectedTime(null);
    try {
      const res = await api.get(`/restaurants/${r.id}/time-slots`, {
        params: { date: formatDate(selectedDate), partySize },
      });
      const data = res.data;
      if (data.banned) {
        setSlotsError('This restaurant is not available.');
      } else if (data.closed) {
        setSlotsError('The restaurant is closed on this day.');
      } else if (data.disabled) {
        setSlotsError('Reservations are not available on this date.');
      } else if (data.timeSlots.length === 0) {
        setSlotsError('No available time slots for this day.');
      } else {
        setTimeSlots(data.timeSlots);
      }
    } catch (e) {
      setSlotsError('Could not load time slots.');
    } finally {
      setLoadingSlots(false);
    }
  }, [r.id, selectedDate, partySize]);

  useEffect(() => {
    fetchTimeSlots();
  }, [fetchTimeSlots]);

  const maxParty = r.maxPartySize || 30;

  const handleBook = async () => {
    if (!selectedDate || !selectedTime) return;

    setSubmitting(true);
    try {
      const res = await api.post('/reservations', {
        restaurantId: r.id,
        date: formatDate(selectedDate),
        time: selectedTime,
        partySize,
        // §5.3 — omit the key entirely when blank so the backend stores null.
        specialRequests: specialRequests.trim() || undefined,
      });

      // Promote to inline step 4 instead of an Alert so the optional
      // phone-collection prompt can render inside the same screen.
      setBookedStatus(res.data.status);
      setStep(4);
    } catch (e) {
      Alert.alert('Booking Failed', getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const isConfirmed = bookedStatus === 'CONFIRMED' || bookedStatus === 'AUTO_CONFIRMED';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Book a Table</Text>
          <Text style={styles.headerSub}>{r.nameEn || r.nameRo}</Text>
        </View>
      </View>

      {/* Progress — hidden on step 4 (the success view) since the flow
          has ended. */}
      {step !== 4 && (
        <View style={styles.progressRow}>
          {[1, 2, 3].map((s) => (
            <View key={s} style={styles.progressItem}>
              <View style={[styles.progressDot, step >= s && styles.progressDotActive]}>
                <Text style={[styles.progressNum, step >= s && styles.progressNumActive]}>{s}</Text>
              </View>
              <Text style={[styles.progressLabel, step >= s && styles.progressLabelActive]}>
                {s === 1 ? 'Date & Guests' : s === 2 ? 'Time' : 'Confirm'}
              </Text>
            </View>
          ))}
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {/* Step 1: Date & Party Size */}
        {step === 1 && (
          <View>
            {/* Party Size */}
            <Text style={styles.stepTitle}>How many guests?</Text>
            <View style={styles.partySizeRow}>
              <TouchableOpacity
                style={styles.partyBtn}
                onPress={() => setPartySize(Math.max(1, partySize - 1))}
              >
                <Ionicons name="remove" size={24} color={Colors.text} />
              </TouchableOpacity>
              <View style={styles.partyDisplay}>
                <Ionicons name="people" size={24} color={Colors.primary} />
                <Text style={styles.partyNumber}>{partySize}</Text>
                <Text style={styles.partyLabel}>{partySize === 1 ? 'guest' : 'guests'}</Text>
              </View>
              <TouchableOpacity
                style={styles.partyBtn}
                onPress={() => setPartySize(Math.min(maxParty, partySize + 1))}
              >
                <Ionicons name="add" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.partyNote}>Max {maxParty} guests per reservation</Text>

            {/* Date Selection */}
            <Text style={[styles.stepTitle, { marginTop: 28 }]}>Select a date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScroll}>
              {dates.map((d) => {
                const iso = formatDate(d);
                const isSelected = iso === formatDate(selectedDate);
                const isDisabled = Object.prototype.hasOwnProperty.call(disabledDates, iso);
                const disabledReason = isDisabled ? disabledDates[iso] : null;
                return (
                  <TouchableOpacity
                    key={iso}
                    style={[
                      styles.dateCard,
                      isSelected && !isDisabled && styles.dateCardActive,
                      isDisabled && styles.dateCardDisabled,
                    ]}
                    onPress={() => {
                      if (isDisabled) {
                        // Show why instead of silently no-op'ing.
                        Alert.alert(
                          'Closed',
                          disabledReason || 'Reservations are not available on this date.'
                        );
                        return;
                      }
                      setSelectedDate(d);
                    }}
                  >
                    <Text style={[
                      styles.dateDay,
                      isSelected && !isDisabled && styles.dateDayActive,
                      isDisabled && styles.dateTextDisabled,
                    ]}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}
                    </Text>
                    <Text style={[
                      styles.dateNum,
                      isSelected && !isDisabled && styles.dateNumActive,
                      isDisabled && styles.dateTextDisabled,
                    ]}>
                      {d.getDate()}
                    </Text>
                    <Text style={[
                      styles.dateMonth,
                      isSelected && !isDisabled && styles.dateMonthActive,
                      isDisabled && styles.dateTextDisabled,
                    ]}>
                      {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}
                    </Text>
                    {isDisabled && <Text style={styles.dateClosedTag}>—</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* §5.3 — optional special requests, visible to restaurant staff */}
            <Text style={[styles.stepTitle, { marginTop: 28 }]}>{t('book.specialRequestsLabel')}</Text>
            <TextInput
              style={styles.specialRequestsInput}
              value={specialRequests}
              onChangeText={setSpecialRequests}
              placeholder={t('book.specialRequestsPlaceholder')}
              placeholderTextColor={Colors.textLight}
              multiline
              maxLength={500}
              textAlignVertical="top"
            />

            <TouchableOpacity style={styles.nextButton} onPress={() => setStep(2)}>
              <Text style={styles.nextButtonText}>Choose Time</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2: Time */}
        {step === 2 && (
          <View>
            <Text style={styles.stepTitle}>Select a time</Text>
            <Text style={styles.stepSub}>{formatDateLabel(selectedDate)} · {partySize} {partySize === 1 ? 'guest' : 'guests'}</Text>

            {loadingSlots ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={{ marginTop: 8, color: Colors.textSecondary }}>Loading available times...</Text>
              </View>
            ) : slotsError ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <Ionicons name="calendar-outline" size={40} color={Colors.textLight} />
                <Text style={{ marginTop: 8, color: Colors.textSecondary, textAlign: 'center' }}>{slotsError}</Text>
              </View>
            ) : (
              <View style={styles.timeGrid}>
                {timeSlots.map((t) => {
                  const isSelected = selectedTime === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.timeSlot, isSelected && styles.timeSlotActive]}
                      onPress={() => setSelectedTime(t)}
                    >
                      <Text style={[styles.timeText, isSelected && styles.timeTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={styles.stepButtons}>
              <TouchableOpacity style={styles.backStepBtn} onPress={() => setStep(1)}>
                <Ionicons name="arrow-back" size={18} color={Colors.text} />
                <Text style={styles.backStepText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.nextButton, { flex: 1 }, !selectedTime && styles.nextButtonDisabled]}
                onPress={() => selectedTime && setStep(3)}
                disabled={!selectedTime}
              >
                <Text style={styles.nextButtonText}>Review</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step 3: Confirmation */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>Confirm your reservation</Text>

            <View style={styles.confirmCard}>
              <View style={styles.confirmRow}>
                <Ionicons name="restaurant-outline" size={20} color={Colors.primary} />
                <View style={styles.confirmInfo}>
                  <Text style={styles.confirmLabel}>Restaurant</Text>
                  <Text style={styles.confirmValue}>{r.nameEn || r.nameRo}</Text>
                </View>
              </View>

              <View style={styles.confirmDivider} />

              <View style={styles.confirmRow}>
                <Ionicons name="calendar-outline" size={20} color={Colors.primary} />
                <View style={styles.confirmInfo}>
                  <Text style={styles.confirmLabel}>Date</Text>
                  <Text style={styles.confirmValue}>{formatDateLabel(selectedDate)}</Text>
                </View>
              </View>

              <View style={styles.confirmDivider} />

              <View style={styles.confirmRow}>
                <Ionicons name="time-outline" size={20} color={Colors.primary} />
                <View style={styles.confirmInfo}>
                  <Text style={styles.confirmLabel}>Time</Text>
                  <Text style={styles.confirmValue}>{selectedTime}</Text>
                </View>
              </View>

              <View style={styles.confirmDivider} />

              <View style={styles.confirmRow}>
                <Ionicons name="people-outline" size={20} color={Colors.primary} />
                <View style={styles.confirmInfo}>
                  <Text style={styles.confirmLabel}>Guests</Text>
                  <Text style={styles.confirmValue}>{partySize} {partySize === 1 ? 'person' : 'people'}</Text>
                </View>
              </View>

            </View>

            <View style={styles.stepButtons}>
              <TouchableOpacity style={styles.backStepBtn} onPress={() => setStep(2)}>
                <Ionicons name="arrow-back" size={18} color={Colors.text} />
                <Text style={styles.backStepText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, { flex: 1 }, submitting && styles.nextButtonDisabled]}
                onPress={handleBook}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={styles.confirmButtonText}>Confirm Booking</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step 4: Success + optional phone-collection prompt */}
        {step === 4 && (
          <View>
            <View style={styles.successHero}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark-circle" size={56} color={Colors.primary} />
              </View>
              <Text style={styles.successTitle}>
                {isConfirmed ? t('bookConfirm.successTitle') : t('bookConfirm.successTitlePending')}
              </Text>
              <Text style={styles.successBody}>
                {isConfirmed ? t('bookConfirm.successBodyConfirmed') : t('bookConfirm.successBodyPending')}
              </Text>
            </View>

            {shouldShowPhonePrompt && (
              <View style={styles.phonePromptCard}>
                <View style={styles.phonePromptHeader}>
                  <Ionicons name="call-outline" size={20} color={Colors.primary} />
                  <Text style={styles.phonePromptTitle}>{t('phonePrompt.headline')}</Text>
                </View>
                <Text style={styles.phonePromptBody}>{t('phonePrompt.body')}</Text>
                <TextInput
                  style={styles.phonePromptInput}
                  value={phoneInput}
                  onChangeText={setPhoneInput}
                  placeholder={t('phonePrompt.placeholder')}
                  placeholderTextColor={Colors.textLight}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  editable={!phonePromptSaving}
                />
                {phonePromptError ? (
                  <Text style={styles.phonePromptErrorText}>{phonePromptError}</Text>
                ) : null}
                <View style={styles.phonePromptBtnRow}>
                  <TouchableOpacity
                    style={[styles.phoneSkipBtn, phonePromptSaving && { opacity: 0.5 }]}
                    onPress={handleSkipPhone}
                    disabled={phonePromptSaving}
                  >
                    <Text style={styles.phoneSkipText}>{t('phonePrompt.skipButton')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.phoneSaveBtn, (phonePromptSaving || !phoneInput.trim()) && { opacity: 0.5 }]}
                    onPress={handleSavePhone}
                    disabled={phonePromptSaving || !phoneInput.trim()}
                  >
                    {phonePromptSaving ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.phoneSaveText}>{t('phonePrompt.addButton')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={[styles.stepButtons, { marginTop: 24 }]}>
              <TouchableOpacity
                style={[styles.confirmButton, { flex: 1 }]}
                onPress={() => navigation.navigate('MainTabs', { screen: 'Reservations' })}
              >
                <Ionicons name="calendar" size={18} color="#fff" />
                <Text style={styles.confirmButtonText}>{t('bookConfirm.viewReservations')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.doneBtnText}>{t('bookConfirm.done')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  headerInfo: { marginLeft: 12 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 14, color: Colors.textSecondary },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    paddingVertical: 16,
    backgroundColor: Colors.surface,
  },
  progressItem: { alignItems: 'center' },
  progressDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  progressDotActive: { backgroundColor: Colors.primary },
  progressNum: { fontSize: 14, fontWeight: '700', color: Colors.textLight },
  progressNumActive: { color: '#fff' },
  progressLabel: { fontSize: 11, color: Colors.textLight },
  progressLabelActive: { color: Colors.primary, fontWeight: '600' },
  body: { flex: 1, padding: 20 },
  stepTitle: { fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  stepSub: { fontSize: 15, color: Colors.textSecondary, marginBottom: 16 },
  // Party size
  partySizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 20 },
  partyBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partyDisplay: { alignItems: 'center', minWidth: 80 },
  partyNumber: { fontSize: 36, fontWeight: '800', color: Colors.text, marginTop: 4 },
  partyLabel: { fontSize: 14, color: Colors.textSecondary },
  partyNote: { textAlign: 'center', fontSize: 13, color: Colors.textLight, marginTop: 8 },
  // Date selection
  dateScroll: { marginTop: 8 },
  dateCard: {
    width: 72,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    marginRight: 10,
  },
  dateCardActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  // Tier F2 disabled-date styling
  dateCardDisabled: { backgroundColor: Colors.borderLight, borderColor: Colors.borderLight, opacity: 0.7 },
  dateTextDisabled: { color: Colors.textLight, textDecorationLine: 'line-through' },
  dateClosedTag: { fontSize: 10, color: Colors.textLight, marginTop: 2 },
  dateDay: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  dateDayActive: { color: 'rgba(255,255,255,0.8)' },
  dateNum: { fontSize: 22, fontWeight: '700', color: Colors.text, marginVertical: 2 },
  dateNumActive: { color: '#fff' },
  dateMonth: { fontSize: 12, color: Colors.textSecondary },
  dateMonthActive: { color: 'rgba(255,255,255,0.8)' },
  // Special requests (§5.3)
  specialRequestsInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.surface,
    minHeight: 88,
    marginTop: 8,
  },
  // Time slots
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  timeSlot: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  timeSlotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  timeText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  timeTextActive: { color: '#fff' },
  // Navigation
  stepButtons: { flexDirection: 'row', gap: 12, marginTop: 28, marginBottom: 40 },
  backStepBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingVertical: 14 },
  backStepText: { fontSize: 15, color: Colors.text, fontWeight: '500' },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 28,
  },
  nextButtonDisabled: { opacity: 0.5 },
  nextButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Confirm
  confirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  confirmInfo: { flex: 1 },
  confirmLabel: { fontSize: 12, color: Colors.textSecondary },
  confirmValue: { fontSize: 16, fontWeight: '600', color: Colors.text, marginTop: 1 },
  confirmDivider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 12 },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  confirmButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Step 4 — success + phone prompt
  successHero: { alignItems: 'center', paddingTop: 8, paddingBottom: 20 },
  successIcon: { marginBottom: 12 },
  successTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 6, textAlign: 'center' },
  successBody: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 },
  phonePromptCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 8,
  },
  phonePromptHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  phonePromptTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  phonePromptBody: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  phonePromptInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  phonePromptErrorText: { color: Colors.error, fontSize: 13, marginTop: 8 },
  phonePromptBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  phoneSkipBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  phoneSkipText: { fontSize: 14, fontWeight: '600', color: Colors.text },
  phoneSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  doneBtn: { alignItems: 'center', paddingVertical: 14, marginBottom: 32 },
  doneBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
});
