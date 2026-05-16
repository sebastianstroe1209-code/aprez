import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
import api, { mediaUrl } from '../lib/api';

const SCREEN_W = Dimensions.get('window').width;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function RestaurantDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadRestaurant();
  }, [id]);

  const loadRestaurant = async () => {
    try {
      const res = await api.get(`/restaurants/${id}`);
      setRestaurant(res.data);
      // Check favorite status
      try {
        const favRes = await api.get('/favorites');
        const favIds = (favRes.data || []).map((f) => f.restaurantId);
        setIsFavorite(favIds.includes(id));
      } catch (e) {
        // Not logged in or favorites unavailable
      }
    } catch (e) {
      if (e.response?.status === 403) {
        setError('This restaurant is currently fully booked.');
      } else {
        setError('Could not load restaurant');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async () => {
    try {
      if (isFavorite) {
        await api.delete(`/favorites/${id}`);
      } else {
        await api.post('/favorites', { restaurantId: id });
      }
      setIsFavorite(!isFavorite);
    } catch (e) {
      // Maybe not logged in
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error || !restaurant) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
        <Text style={styles.errorText}>{error || 'Restaurant not found'}</Text>
      </View>
    );
  }

  const r = restaurant;
  const openingHours = r.openingHours || [];
  const servicePeriods = r.servicePeriods || [];

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Cover Image — Tier F: mediaUrl() resolves the relative
            /uploads/... path stored in the DB to a full URL. */}
        <View style={styles.coverContainer}>
          {r.coverPhotoUrl ? (
            <Image source={{ uri: mediaUrl(r.coverPhotoUrl) }} style={styles.coverImage} />
          ) : (
            <View style={styles.coverPlaceholder}>
              <Ionicons name="restaurant" size={60} color={Colors.primaryLight} />
            </View>
          )}
          {/* Back + Favorite buttons */}
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.topBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={22} color={Colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.topBtn} onPress={toggleFavorite}>
              <Ionicons
                name={isFavorite ? 'heart' : 'heart-outline'}
                size={22}
                color={isFavorite ? Colors.error : Colors.text}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Restaurant Info */}
        <View style={styles.infoSection}>
          <Text style={styles.name}>{r.nameEn || r.nameRo}</Text>

          {r.cuisineTypes?.length > 0 && (
            <View style={styles.cuisineRow}>
              {r.cuisineTypes.map((c, i) => (
                <View key={i} style={styles.cuisineChip}>
                  <Text style={styles.cuisineChipText}>{c}</Text>
                </View>
              ))}
            </View>
          )}

          {r.descriptionEn || r.descriptionRo ? (
            <Text style={styles.description}>{r.descriptionEn || r.descriptionRo}</Text>
          ) : null}

          {/* Contact Info */}
          <View style={styles.contactSection}>
            <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`tel:${r.phone}`)}>
              <Ionicons name="call-outline" size={18} color={Colors.primary} />
              <Text style={styles.contactText}>{r.phone}</Text>
            </TouchableOpacity>

            <View style={styles.contactRow}>
              <Ionicons name="location-outline" size={18} color={Colors.primary} />
              <Text style={styles.contactText}>{r.address}</Text>
            </View>

            {r.email && (
              <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${r.email}`)}>
                <Ionicons name="mail-outline" size={18} color={Colors.primary} />
                <Text style={styles.contactText}>{r.email}</Text>
              </TouchableOpacity>
            )}

            {r.website && (
              <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(r.website)}>
                <Ionicons name="globe-outline" size={18} color={Colors.primary} />
                <Text style={styles.contactText}>{r.website}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Photo Gallery — Tier F. Renders a swipeable carousel of the
            non-cover photos so the cover stays in its hero slot above. */}
        {Array.isArray(r.photos) && r.photos.length > 0 && (
          <View style={styles.gallerySection}>
            <Text style={styles.sectionTitle}>Photos</Text>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.galleryScroll}
            >
              {r.photos.map((p) => (
                <Image
                  key={p.id}
                  source={{ uri: mediaUrl(p.photoUrl) }}
                  style={[styles.galleryImage, { width: SCREEN_W - 40 }]}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Menu PDF — Tier F. System PDF viewer via Linking. */}
        {r.menuPdfUrl && (
          <View style={styles.menuSection}>
            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => Linking.openURL(mediaUrl(r.menuPdfUrl))}
            >
              <Ionicons name="document-text-outline" size={20} color={Colors.primary} />
              <Text style={styles.menuBtnText}>View Menu</Text>
              <Ionicons name="open-outline" size={18} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Opening Hours */}
        {openingHours.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Opening Hours</Text>
            {openingHours.map((oh, i) => (
              <View key={i} style={styles.hoursRow}>
                <Text style={styles.dayName}>{DAYS[oh.dayOfWeek] || `Day ${oh.dayOfWeek}`}</Text>
                <Text style={[styles.hoursTime, !oh.isOpen && styles.closedText]}>
                  {oh.isOpen ? `${oh.openTime} - ${oh.closeTime}` : 'Closed'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Service Periods */}
        {servicePeriods.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Service Periods</Text>
            {servicePeriods.map((sp, i) => (
              <View key={i} style={styles.spCard}>
                <View style={styles.spHeader}>
                  <Text style={styles.spName}>{sp.nameEn || sp.nameRo}</Text>
                  <Text style={styles.spTime}>{sp.startTime} - {sp.endTime}</Text>
                </View>
                {sp.daysOfWeek && sp.daysOfWeek.length < 7 && (
                  <View style={styles.spDays}>
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <View
                        key={d}
                        style={[styles.spDayDot, sp.daysOfWeek.includes(d) && styles.spDayDotActive]}
                      >
                        <Text
                          style={[styles.spDayText, sp.daysOfWeek.includes(d) && styles.spDayTextActive]}
                        >
                          {DAY_SHORT[d][0]}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Spacer for button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Book Now Button */}
      <View style={styles.bookBar}>
        <TouchableOpacity
          style={[styles.bookButton, { flex: 1 }]}
          onPress={() => navigation.navigate('BookReservation', { restaurant: r })}
        >
          <Ionicons name="calendar-outline" size={20} color="#fff" />
          <Text style={styles.bookButtonText}>Make a Reservation</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: Colors.error, marginTop: 12 },
  coverContainer: { height: 240, position: 'relative' },
  coverImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryBg },
  topBar: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoSection: { padding: 20 },
  name: { fontSize: 26, fontWeight: '800', color: Colors.text },
  cuisineRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 },
  cuisineChip: {
    backgroundColor: Colors.primaryBg,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  cuisineChipText: { fontSize: 13, fontWeight: '600', color: Colors.primaryDark },
  description: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22, marginTop: 14 },
  contactSection: { marginTop: 20, gap: 10 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contactText: { fontSize: 14, color: Colors.text },
  section: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  dayName: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  hoursTime: { fontSize: 14, color: Colors.textSecondary },
  closedText: { color: Colors.error },
  spCard: {
    backgroundColor: Colors.primaryBg,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  spHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  spName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  spTime: { fontSize: 14, color: Colors.primaryDark, fontWeight: '600' },
  spDays: { flexDirection: 'row', gap: 4, marginTop: 8 },
  spDayDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spDayDotActive: { backgroundColor: Colors.primary },
  spDayText: { fontSize: 11, fontWeight: '600', color: Colors.textLight },
  spDayTextActive: { color: '#fff' },
  bookBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 34, // safe area
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 5,
  },
  bookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  bookButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Tier F — gallery + menu
  gallerySection: { marginHorizontal: 20, marginBottom: 20 },
  galleryScroll: { marginTop: 8 },
  galleryImage: {
    height: 200,
    borderRadius: 12,
    marginRight: 8,
    resizeMode: 'cover',
    backgroundColor: Colors.borderLight,
  },
  menuSection: { marginHorizontal: 20, marginBottom: 20 },
  menuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  menuBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
});
