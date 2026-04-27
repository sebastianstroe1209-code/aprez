import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
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

export default function HomeScreen({ navigation }) {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCuisine, setActiveCuisine] = useState('All');

  const loadRestaurants = useCallback(async () => {
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (activeCuisine !== 'All') params.cuisine = activeCuisine;
      const res = await api.get('/restaurants', { params });
      setRestaurants(res.data.restaurants || res.data || []);
    } catch (e) {
      console.log('Failed to load restaurants:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, activeCuisine]);

  useEffect(() => {
    loadRestaurants();
  }, [loadRestaurants]);

  const onRefresh = () => {
    setRefreshing(true);
    loadRestaurants();
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
                ? `${Math.round(item.distance * 1000)}m away`
                : `${item.distance.toFixed(1)}km away`}
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
              <Ionicons name="restaurant-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>No restaurants found</Text>
              <Text style={styles.emptySubtext}>Try a different search or filter</Text>
            </View>
          }
        />
      )}
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
  filterText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: '#fff' },
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
  emptyText: { fontSize: 17, fontWeight: '600', color: Colors.textSecondary, marginTop: 12 },
  emptySubtext: { fontSize: 14, color: Colors.textLight, marginTop: 4 },
});
