import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../lib/colors';
import { useAuth } from '../contexts/AuthContext';

// Screens
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import HomeScreen from '../screens/HomeScreen';
import RestaurantDetailScreen from '../screens/RestaurantDetailScreen';
import BookReservationScreen from '../screens/BookReservationScreen';
import ReservationsScreen from '../screens/ReservationsScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import ProfileScreen from '../screens/ProfileScreen';

const AuthStackNav = createNativeStackNavigator();
const AppStackNav = createNativeStackNavigator();
const TabNav = createBottomTabNavigator();

function HomeTabs() {
  return (
    <TabNav.Navigator
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          paddingBottom: 6,
          paddingTop: 6,
          height: 60,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShown: false,
      }}
    >
      <TabNav.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'restaurant' : 'restaurant-outline'} size={size} color={color} />
          ),
        }}
      />
      <TabNav.Screen
        name="Reservations"
        component={ReservationsScreen}
        options={{
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={size} color={color} />
          ),
        }}
      />
      <TabNav.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'heart' : 'heart-outline'} size={size} color={color} />
          ),
        }}
      />
      <TabNav.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </TabNav.Navigator>
  );
}

function AuthStack() {
  return (
    <AuthStackNav.Navigator screenOptions={{ headerShown: false }}>
      <AuthStackNav.Screen name="Login" component={LoginScreen} />
      <AuthStackNav.Screen name="Register" component={RegisterScreen} />
    </AuthStackNav.Navigator>
  );
}

function AppStack() {
  return (
    <AppStackNav.Navigator>
      <AppStackNav.Screen
        name="MainTabs"
        component={HomeTabs}
        options={{ headerShown: false }}
      />
      <AppStackNav.Screen
        name="RestaurantDetail"
        component={RestaurantDetailScreen}
        options={{ headerShown: false }}
      />
      <AppStackNav.Screen
        name="BookReservation"
        component={BookReservationScreen}
        options={{ headerShown: false }}
      />
    </AppStackNav.Navigator>
  );
}

export default function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
