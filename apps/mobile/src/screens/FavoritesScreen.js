import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Image,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
import api from '../lib/api';
import { useFocusEffect } from '@react-navigation/native';

export default function FavoritesScreen({ navigation }) {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFavorites = async () => {
    try {
      const res = await api.get('/favorites');
      setFavorites(res.data || []);
    } catch (e) {
      console.log('Failed to load favorites:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
    }, [])
  );

  const removeFavorite = async (restaurantId) => {
    try {
      await api.delete(`/favorites/${restaurantId}`);
      setFavorites((prev) => prev.filter((f) => f.restaurantId !== restaurantId));
    } catch (e) {
      // silent
    }
  };

  const renderFavorite = ({ item }) => {
    const r = item.restaurant || item;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('RestaurantDetail', { id: r.id || item.restaurantId })}
        activeOpacity={0.7}
      >
        <View style={styles.cardCover}>
          {r.coverPhotoUrl ? (
            <Image source={{ uri: r.coverPhotoUrl }} style={styles.coverImage} />
          ) : (
            <View style={styles.coverPlaceholder}>
              <Ionicons name="restaurant" size={28} color={Colors.primaryLight} />
            </View>
          )}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={1}>{r.nameEn || r.nameRo}</Text>
          <View style={styles.cardRow}>
            <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.cardAddress} numberOfLines={1}>{r.address}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.heartBtn} onPress={() => removeFavorite(item.restaurantId || r.id)}>
          <Ionicons name="heart" size={22} color={Colors.error} />
        </TouchableOpacity>
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
      <View style={styles.header}>
        <Text style={styles.title}>Favorites</Text>
      </View>

      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id || item.restaurantId}
        renderItem={renderFavorite}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFavorites(); }} tintColor={Colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>No favorites yet</Text>
            <Text style={styles.emptySubtitle}>Tap the heart icon on restaurants you love</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text },
  listContent: { padding: 20, paddingTop: 8 },
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardCover: { width: 80, height: 80 },
  coverImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryBg },
  cardBody: { flex: 1, padding: 12 },
  cardName: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardAddress: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  heartBtn: { padding: 14 },
  emptyState: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSecondary, marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: Colors.textLight, marginTop: 4, textAlign: 'center' },
});
