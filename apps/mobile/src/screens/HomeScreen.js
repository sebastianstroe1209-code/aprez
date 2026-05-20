import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  RefreshControl,
  Image,
  ActivityIndicator,
  SafeAreaView,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { Colors } from '../lib/colors';
import { formatDate } from '../lib/format';
import api from '../lib/api';

const CUISINE_FILTERS = [
  'All',
  'Romanian',
  'Italian',
  'Asian',
  'French',
  'Mediterranean',
  'Japanese',
  'Chinese',
  'Indian',
  'Mexican',
  'American',
  'Greek',
  'Turkish',
  'Seafood',
  'Steakhouse',
  'Vegetarian',
  'Vegan',
  'Pizza',
  'Fast Food',
  'Cafe',
  'Bar',
  'Fine Dining',
  'Traditional',
];

// G5b — time-picker range. The home screen has no per-restaurant
// opening hours loaded (the list payload omits them), so the slot list
// uses a fixed 08:00–23:45 window that covers virtually every venue;
// the backend availability join is the real authority on whether a
// slot is serviceable.
const TIME_MIN = 8 * 60;
const TIME_MAX = 23 * 60 + 45;
const pad = (n) => String(n).padStart(2, '0');
const minToHHmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const TIME_SLOTS = (() => {
  const slots = [];
  for (let m = TIME_MIN; m <= TIME_MAX; m += 15) slots.push(minToHHmm(m));
  return slots;
})();
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

// Next 30-minute slot from now, clamped into the slot range — the
// Time picker's default.
function defaultTimeSlot() {
  const now = new Date();
  let m = (Math.floor((now.getHours() * 60 + now.getMinutes()) / 30) + 1) * 30;
  if (m < TIME_MIN) m = TIME_MIN;
  if (m > TIME_MAX) m = TIME_MAX;
  return minToHHmm(m);
}

// Month grid cells (Monday-first); null entries are leading/trailing pads.
function buildMonthCells(monthDate) {
  const y = monthDate.getFullYear();
  const mo = monthDate.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, mo, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function HomeScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCuisine, setActiveCuisine] = useState('All');
  // G5a — location filter. coords are sent on the /restaurants query so
  // the backend sorts by Haversine distance. locating guards the GPS
  // fetch; locationMsg surfaces a localized fallback when GPS is denied.
  const [locationActive, setLocationActive] = useState(false);
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationMsg, setLocationMsg] = useState('');
  // G5b — party/date/time availability filter. All three must be set
  // before any query param is sent (all-or-none); until then the list
  // stays unfiltered.
  const [partyFilter, setPartyFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState(null); // 'YYYY-MM-DD'
  const [timeFilter, setTimeFilter] = useState(null); // 'HH:mm'
  const [activePicker, setActivePicker] = useState(null); // 'party' | 'date' | 'time' | null
  // Picker draft values — committed to the filters only on "Set".
  const [draftParty, setDraftParty] = useState(2);
  const [draftDate, setDraftDate] = useState(null);
  const [draftTime, setDraftTime] = useState(null);
  const [calMonth, setCalMonth] = useState(() => firstOfMonth(new Date()));

  const todayIso = useMemo(() => isoLocal(new Date()), []);
  const currentMonth = useMemo(() => firstOfMonth(new Date()), []);

  // Monday-first weekday initials, localized via Intl from this week's
  // Monday — no hardcoded day-name strings to translate.
  const weekdayLabels = useMemo(() => {
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return fmt.format(d);
    });
  }, [i18n.language]);

  const filtersSet = partyFilter != null && dateFilter != null && timeFilter != null;
  const someFiltersSet = partyFilter != null || dateFilter != null || timeFilter != null;
  const needsAttention = someFiltersSet && !filtersSet;

  const loadRestaurants = useCallback(async () => {
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (activeCuisine !== 'All') params.cuisine = activeCuisine;
      if (locationActive && coords) {
        params.lat = coords.lat;
        params.lng = coords.lng;
      }
      // All-or-none: only send the availability params once all three
      // are set, so a half-configured filter never narrows the list.
      if (partyFilter != null && dateFilter != null && timeFilter != null) {
        params.partySize = partyFilter;
        params.date = dateFilter;
        params.time = timeFilter;
      }
      const res = await api.get('/restaurants', { params });
      setRestaurants(res.data.restaurants || res.data || []);
    } catch (e) {
      console.log('Failed to load restaurants:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, activeCuisine, locationActive, coords, partyFilter, dateFilter, timeFilter]);

  // G5a — toggle the location filter. Permissions are requested only on
  // this explicit tap (never on render); Expo caches the grant so an
  // already-granted user is not re-prompted. On denial/failure the
  // filter stays off and a localized hint is shown.
  const handleLocationToggle = useCallback(async () => {
    if (locationActive) {
      setLocationActive(false);
      setCoords(null);
      setLocationMsg('');
      return;
    }
    setLocationMsg('');
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationMsg(t('homeFilters.locationDenied'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setLocationActive(true);
    } catch (e) {
      setLocationMsg(t('homeFilters.locationError'));
    } finally {
      setLocating(false);
    }
  }, [locationActive, t]);

  useEffect(() => {
    loadRestaurants();
  }, [loadRestaurants]);

  const onRefresh = () => {
    setRefreshing(true);
    loadRestaurants();
  };

  // Seed the draft from the committed value (or a default) and open.
  const openPicker = (which) => {
    if (which === 'party') {
      setDraftParty(partyFilter ?? 2);
    } else if (which === 'date') {
      const seed = dateFilter ?? todayIso;
      setDraftDate(seed);
      setCalMonth(firstOfMonth(new Date(`${seed}T00:00:00`)));
    } else if (which === 'time') {
      setDraftTime(timeFilter ?? defaultTimeSlot());
    }
    setActivePicker(which);
  };

  const applyPicker = () => {
    if (activePicker === 'party') setPartyFilter(draftParty);
    else if (activePicker === 'date') setDateFilter(draftDate);
    else if (activePicker === 'time') setTimeFilter(draftTime);
    setActivePicker(null);
  };

  const clearAllFilters = () => {
    setPartyFilter(null);
    setDateFilter(null);
    setTimeFilter(null);
  };

  const dateChipLabel =
    dateFilter == null
      ? t('homeFilters.date.label')
      : dateFilter === todayIso
        ? t('homeFilters.date.today')
        : formatDate(dateFilter);

  // A filter chip. `value` null → shows the label; set → shows the
  // value with an inline clear ×. When the filter is half-set, an
  // unset chip is highlighted to hint it still needs a value.
  const renderFilterChip = (which, icon, label, value, onClear) => {
    const isSet = value != null;
    const hint = needsAttention && !isSet;
    return (
      <TouchableOpacity
        style={[
          styles.filterChip,
          styles.iconChip,
          isSet && styles.filterChipActive,
          hint && styles.filterChipHint,
        ]}
        onPress={() => openPicker(which)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={icon}
          size={14}
          color={isSet ? '#fff' : hint ? Colors.primary : Colors.textSecondary}
        />
        <Text
          style={[
            styles.filterText,
            isSet && styles.filterTextActive,
            hint && styles.filterTextHint,
          ]}
        >
          {isSet ? String(value) : label}
        </Text>
        {isSet && (
          <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={15} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderRestaurant = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('RestaurantDetail', { id: item.id })}
      activeOpacity={0.7}
    >
      {/* Cover Photo */}
      <View style={styles.coverContainer}>
        {item.coverPhotoUrl ? (
          <Image source={{ uri: item.coverPhotoUrl }} style={styles.coverImage} />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Ionicons name="restaurant" size={40} color={Colors.primaryLight} />
          </View>
        )}
        {/* Cuisine badges */}
        {item.cuisineTypes?.length > 0 && (
          <View style={styles.cuisineBadgeRow}>
            {item.cuisineTypes.slice(0, 2).map((c, i) => (
              <View key={i} style={styles.cuisineBadge}>
                <Text style={styles.cuisineBadgeText}>{c}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {item.nameEn || item.nameRo}
        </Text>
        <View style={styles.cardRow}>
          <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.cardAddress} numberOfLines={1}>
            {item.address}
          </Text>
        </View>
        {item.distance !== undefined && (
          <View style={styles.cardRow}>
            <Ionicons name="navigate-outline" size={14} color={Colors.primary} />
            <Text style={styles.cardDistance}>
              {item.distance < 1
                ? t('homeFilters.distanceMeters', { m: Math.round(item.distance * 1000) })
                : t('homeFilters.distanceKm', { km: item.distance.toFixed(1) })}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Find a table</Text>
        <Text style={styles.subGreeting}>Browse restaurants across Romania</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={Colors.textLight} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search restaurants..."
          placeholderTextColor={Colors.textLight}
          returnKeyType="search"
          onSubmitEditing={loadRestaurants}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={20} color={Colors.textLight} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips — Nearby (G5a) + Party / Date / Time (G5b) */}
      <View style={styles.locationRow}>
        <TouchableOpacity
          style={[styles.filterChip, styles.iconChip, locationActive && styles.filterChipActive]}
          onPress={handleLocationToggle}
          disabled={locating}
          activeOpacity={0.7}
        >
          {locating ? (
            <ActivityIndicator size="small" color={locationActive ? '#fff' : Colors.primary} />
          ) : (
            <Ionicons
              name="navigate"
              size={14}
              color={locationActive ? '#fff' : Colors.textSecondary}
            />
          )}
          <Text style={[styles.filterText, locationActive && styles.filterTextActive]}>
            {locating ? t('homeFilters.locating') : t('homeFilters.nearby')}
          </Text>
        </TouchableOpacity>

        {renderFilterChip(
          'party', 'people-outline', t('homeFilters.party.label'), partyFilter,
          () => setPartyFilter(null),
        )}
        {renderFilterChip(
          'date', 'calendar-outline', t('homeFilters.date.label'),
          dateFilter == null ? null : dateChipLabel,
          () => setDateFilter(null),
        )}
        {renderFilterChip(
          'time', 'time-outline', t('homeFilters.time.label'), timeFilter,
          () => setTimeFilter(null),
        )}

        {filtersSet && (
          <TouchableOpacity
            style={[styles.filterChip, styles.iconChip]}
            onPress={clearAllFilters}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={14} color={Colors.textSecondary} />
            <Text style={styles.filterText}>{t('homeFilters.clearAll')}</Text>
          </TouchableOpacity>
        )}

        {locationMsg ? <Text style={styles.locationMsg}>{locationMsg}</Text> : null}
      </View>

      {/* All-or-none hint / result count */}
      {needsAttention ? (
        <Text style={styles.allOrNoneHint}>{t('homeFilters.allOrNoneHint')}</Text>
      ) : filtersSet && !loading ? (
        <Text style={styles.resultCount}>
          {t('homeFilters.resultCount', { count: restaurants.length })}
        </Text>
      ) : null}

      {/* Cuisine Filters */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CUISINE_FILTERS}
        keyExtractor={(item) => item}
        style={styles.filterList}
        contentContainerStyle={styles.filterContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.filterChip, activeCuisine === item && styles.filterChipActive]}
            onPress={() => setActiveCuisine(item)}
          >
            <Text style={[styles.filterText, activeCuisine === item && styles.filterTextActive]}>
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Restaurant List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={restaurants}
          keyExtractor={(item) => item.id}
          renderItem={renderRestaurant}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons
                name={filtersSet ? 'time-outline' : 'restaurant-outline'}
                size={48}
                color={Colors.textLight}
              />
              <Text style={styles.emptyText}>
                {filtersSet ? t('homeFilters.emptyState') : 'No restaurants found'}
              </Text>
              {!filtersSet && (
                <Text style={styles.emptySubtext}>Try a different search or filter</Text>
              )}
            </View>
          }
        />
      )}

      {/* Picker modal — Party / Date / Time */}
      <Modal
        visible={activePicker !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActivePicker(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setActivePicker(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />

            {/* Party stepper */}
            {activePicker === 'party' && (
              <>
                <Text style={styles.sheetTitle}>{t('homeFilters.party.title')}</Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={[styles.stepBtn, draftParty <= 1 && styles.stepBtnDisabled]}
                    onPress={() => setDraftParty(Math.max(1, draftParty - 1))}
                    disabled={draftParty <= 1}
                    accessibilityLabel={t('homeFilters.party.stepperDown')}
                  >
                    <Ionicons name="remove" size={26} color={Colors.text} />
                  </TouchableOpacity>
                  <View style={styles.stepValue}>
                    <Ionicons name="people" size={22} color={Colors.primary} />
                    <Text style={styles.stepNumber}>{draftParty}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.stepBtn, draftParty >= 30 && styles.stepBtnDisabled]}
                    onPress={() => setDraftParty(Math.min(30, draftParty + 1))}
                    disabled={draftParty >= 30}
                    accessibilityLabel={t('homeFilters.party.stepperUp')}
                  >
                    <Ionicons name="add" size={26} color={Colors.text} />
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Date calendar grid */}
            {activePicker === 'date' && (
              <>
                <Text style={styles.sheetTitle}>{t('homeFilters.date.title')}</Text>
                <View style={styles.calHeader}>
                  <TouchableOpacity
                    onPress={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                    disabled={calMonth.getTime() <= currentMonth.getTime()}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name="chevron-back"
                      size={22}
                      color={calMonth.getTime() <= currentMonth.getTime() ? Colors.borderLight : Colors.text}
                    />
                  </TouchableOpacity>
                  <Text style={styles.calMonthLabel}>
                    {new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(calMonth)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="chevron-forward" size={22} color={Colors.text} />
                  </TouchableOpacity>
                </View>
                <View style={styles.weekRow}>
                  {weekdayLabels.map((w, i) => (
                    <Text key={i} style={styles.weekday}>{w}</Text>
                  ))}
                </View>
                <View style={styles.calGrid}>
                  {buildMonthCells(calMonth).map((cell, i) => {
                    if (!cell) return <View key={`p${i}`} style={styles.dayCell} />;
                    const iso = isoLocal(cell);
                    const isPast = iso < todayIso;
                    const isSelected = iso === draftDate;
                    return (
                      <TouchableOpacity
                        key={iso}
                        style={[
                          styles.dayCell,
                          isSelected && styles.dayCellSelected,
                          isPast && styles.dayCellDisabled,
                        ]}
                        disabled={isPast}
                        onPress={() => setDraftDate(iso)}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            isSelected && styles.dayTextSelected,
                            isPast && styles.dayTextDisabled,
                          ]}
                        >
                          {cell.getDate()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Time slots */}
            {activePicker === 'time' && (
              <>
                <Text style={styles.sheetTitle}>{t('homeFilters.time.title')}</Text>
                <ScrollView style={styles.timeScroll} contentContainerStyle={styles.timeGrid}>
                  {TIME_SLOTS.map((slot) => {
                    const isSelected = slot === draftTime;
                    return (
                      <TouchableOpacity
                        key={slot}
                        style={[styles.timeSlot, isSelected && styles.timeSlotActive]}
                        onPress={() => setDraftTime(slot)}
                      >
                        <Text style={[styles.timeSlotText, isSelected && styles.timeSlotTextActive]}>
                          {slot}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <TouchableOpacity style={styles.setButton} onPress={applyPicker}>
              <Text style={styles.setButtonText}>{t('homeFilters.setButton')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  greeting: { fontSize: 28, fontWeight: '800', color: Colors.text },
  subGreeting: { fontSize: 15, color: Colors.textSecondary, marginTop: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, paddingVertical: 12, marginLeft: 8, fontSize: 16, color: Colors.text },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    marginTop: 12,
    gap: 10,
  },
  iconChip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 0 },
  locationMsg: { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  allOrNoneHint: {
    fontSize: 12,
    color: Colors.primary,
    paddingHorizontal: 20,
    marginTop: 10,
  },
  resultCount: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    paddingHorizontal: 20,
    marginTop: 10,
  },
  filterList: { maxHeight: 48, marginTop: 12 },
  filterContent: { paddingHorizontal: 16, gap: 8 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  // Half-set hint — an unset filter chip while the other(s) are set.
  filterChipHint: {
    backgroundColor: Colors.primaryBg,
    borderColor: Colors.primary,
  },
  filterText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  filterTextHint: { color: Colors.primary },
  listContent: { padding: 20, paddingTop: 12 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  coverContainer: { height: 160, backgroundColor: Colors.borderLight, position: 'relative' },
  coverImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryBg },
  cuisineBadgeRow: { position: 'absolute', bottom: 10, left: 10, flexDirection: 'row', gap: 6 },
  cuisineBadge: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cuisineBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.text },
  cardBody: { padding: 14 },
  cardName: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cardAddress: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  cardDistance: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 17, fontWeight: '600', color: Colors.textSecondary, marginTop: 12, textAlign: 'center', paddingHorizontal: 32 },
  emptySubtext: { fontSize: 14, color: Colors.textLight, marginTop: 4 },
  // Picker modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 16 },
  // Party stepper
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingVertical: 8,
  },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.4 },
  stepValue: { alignItems: 'center', minWidth: 72 },
  stepNumber: { fontSize: 40, fontWeight: '800', color: Colors.text, marginTop: 2 },
  // Calendar
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calMonthLabel: { fontSize: 15, fontWeight: '700', color: Colors.text, textTransform: 'capitalize' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textLight,
  },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  dayCellSelected: {},
  dayCellDisabled: {},
  dayText: {
    fontSize: 15,
    color: Colors.text,
    width: 38,
    height: 38,
    borderRadius: 19,
    textAlign: 'center',
    textAlignVertical: 'center',
    lineHeight: 38,
  },
  dayTextSelected: {
    backgroundColor: Colors.primary,
    color: '#fff',
    fontWeight: '700',
    overflow: 'hidden',
  },
  dayTextDisabled: { color: Colors.borderLight },
  // Time grid
  timeScroll: { maxHeight: 320 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  timeSlot: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  timeSlotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  timeSlotText: { fontSize: 14, fontWeight: '600', color: Colors.text },
  timeSlotTextActive: { color: '#fff' },
  // Set button
  setButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  setButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
