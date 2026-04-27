import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
import api, { getErrorMessage } from '../lib/api';

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

  const dates = useMemo(() => generateDates(14), []);

  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [selectedTime, setSelectedTime] = useState(null);
  const [partySize, setPartySize] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1); // 1=date, 2=time, 3=confirm
  const [timeSlots, setTimeSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState('');

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
      });

      const status = res.data.status;
      const statusMessage =
        status === 'CONFIRMED' || status === 'AUTO_CONFIRMED'
          ? 'Your reservation has been confirmed!'
          : 'Your reservation is pending confirmation from the restaurant.';

      Alert.alert('Reservation Created!', statusMessage, [
        {
          text: 'View My Reservations',
          onPress: () => navigation.navigate('MainTabs', { screen: 'Reservations' }),
        },
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Booking Failed', getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

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

      {/* Progress */}
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
                const isSelected = formatDate(d) === formatDate(selectedDate);
                return (
                  <TouchableOpacity
                    key={formatDate(d)}
                    style={[styles.dateCard, isSelected && styles.dateCardActive]}
                    onPress={() => setSelectedDate(d)}
                  >
                    <Text style={[styles.dateDay, isSelected && styles.dateDayActive]}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}
                    </Text>
                    <Text style={[styles.dateNum, isSelected && styles.dateNumActive]}>
                      {d.getDate()}
                    </Text>
                    <Text style={[styles.dateMonth, isSelected && styles.dateMonthActive]}>
                      {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

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
  dateDay: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  dateDayActive: { color: 'rgba(255,255,255,0.8)' },
  dateNum: { fontSize: 22, fontWeight: '700', color: Colors.text, marginVertical: 2 },
  dateNumActive: { color: '#fff' },
  dateMonth: { fontSize: 12, color: Colors.textSecondary },
  dateMonthActive: { color: 'rgba(255,255,255,0.8)' },
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
});
