import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../lib/colors';
import { useAuth } from '../contexts/AuthContext';
import { navigationRef } from '../lib/navigationRef';

// Screens
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
import HomeScreen from '../screens/HomeScreen';
import RestaurantDetailScreen from '../screens/RestaurantDetailScreen';
import BookReservationScreen from '../screens/BookReservationScreen';
import ReservationsScreen from '../screens/ReservationsScreen';
import ReservationDetailScreen from '../screens/ReservationDetailScreen';
import RequestChangeScreen from '../screens/RequestChangeScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import ProfileScreen from '../screens/ProfileScreen';

// Tier D commit 2 — Expo Linking config. The deep link aprez://reset-password?token=…
// arrives in the email sent by /api/auth/diner/forgot-password. When the
// app handles it React Navigation injects the token into ResetPassword's
// route.params automatically. Note: the linking config only routes WITHIN
// the AuthStack — once the diner is logged in the deep link is ignored
// because ResetPassword is registered there. This matches the spec: reset
// only happens from the logged-out state.
const linking = {
  prefixes: ['aprez://'],
  config: {
    screens: {
      Login: 'login',
      Register: 'register',
      ForgotPassword: 'forgot-password',
      ResetPassword: 'reset-password',
    },
  },
};

const AuthStackNav = createNativeStackNavigator();
const AppStackNav = createNativeStackNavigator();
const TabNav = createBottomTabNavigator();

function HomeTabs() {
  const { t } = useTranslation();
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
          tabBarLabel: t('tabs.home'),
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'restaurant' : 'restaurant-outline'} size={size} color={color} />
          ),
        }}
      />
      <TabNav.Screen
        name="Reservations"
        component={ReservationsScreen}
        options={{
          tabBarLabel: t('tabs.reservations'),
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={size} color={color} />
          ),
        }}
      />
      <TabNav.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{
          tabBarLabel: t('tabs.favorites'),
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'heart' : 'heart-outline'} size={size} color={color} />
          ),
        }}
      />
      <TabNav.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: t('tabs.profile'),
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
      <AuthStackNav.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <AuthStackNav.Screen name="ResetPassword" component={ResetPasswordScreen} />
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
      {/* Tier E commit 2 — per-reservation detail + modification request. */}
      <AppStackNav.Screen
        name="ReservationDetail"
        component={ReservationDetailScreen}
        options={{ headerShown: false }}
      />
      <AppStackNav.Screen
        name="RequestChange"
        component={RequestChangeScreen}
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
    <NavigationContainer ref={navigationRef} linking={linking}>
      {user ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
