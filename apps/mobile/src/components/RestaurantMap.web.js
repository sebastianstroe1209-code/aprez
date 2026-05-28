import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';

// Web placeholder for RestaurantMap. react-native-maps imports
// native-only modules and breaks the web bundle, so we render a
// same-size block here to preserve layout in the Chrome QA preview.
export default function RestaurantMap({ latitude, longitude, style }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  return (
    <View style={[styles.container, style]}>
      <Ionicons name="map-outline" size={28} color={Colors.textSecondary} />
      <Text style={styles.title}>Map not available on web preview</Text>
      {hasCoords && (
        <Text style={styles.coords}>
          {lat.toFixed(4)}, {lng.toFixed(4)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryBg,
    gap: 6,
  },
  title: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  coords: { fontSize: 12, color: Colors.textLight },
});
