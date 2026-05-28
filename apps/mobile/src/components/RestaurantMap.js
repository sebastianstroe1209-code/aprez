import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

// Native (iOS + Android) restaurant map. The web counterpart lives in
// RestaurantMap.web.js — Metro picks the right one per platform, so
// react-native-maps never ends up in the web bundle.
export default function RestaurantMap({ latitude, longitude, title, style }) {
  return (
    <View style={[styles.container, style]}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }}
      >
        <Marker coordinate={{ latitude, longitude }} title={title} />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 200 },
  map: { width: '100%', height: '100%' },
});
