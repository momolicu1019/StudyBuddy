import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Toast } from '../components/ui';
import { useApp } from '../context/AppContext';
import { useAuth, useAuthInitials } from '../context/AuthContext';
import { AccountModal } from '../screens/AccountModal';
import { AITutorScreen } from '../screens/AITutorScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { FlashcardsScreen } from '../screens/FlashcardsScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { PomodoroScreen } from '../screens/PomodoroScreen';
import { QuizScreen } from '../screens/QuizScreen';
import { StudyScreen } from '../screens/StudyScreen';
import { colors } from '../theme/colors';
import type { MainTabParamList, RootStackParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function BrandHeader() {
  const initials = useAuthInitials();
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <>
      <View style={styles.topbar}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>✦</Text>
          </View>
          <Text style={styles.brandText}>Study Buddy AI</Text>
        </View>
        <Pressable style={styles.avatar} onPress={() => setAccountOpen(true)}>
          <Text style={styles.avatarText}>{initials}</Text>
        </Pressable>
      </View>
      <AccountModal visible={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const map: Record<string, string> = {
    Dashboard: '⌂',
    Flashcards: '▣',
    Quiz: '✓',
    'AI Tutor': '✦',
    Pomodoro: '◷',
  };
  return (
    <Text style={{ color: focused ? colors.primary : colors.muted, fontSize: 16 }}>
      {map[label] ?? '•'}
    </Text>
  );
}

function MainTabs() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BrandHeader />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabLabel,
          tabBarIcon: ({ focused }) => {
            const labels: Record<string, string> = {
              Dashboard: 'Dashboard',
              FlashcardsTab: 'Flashcards',
              QuizTab: 'Quiz',
              AITutorTab: 'AI Tutor',
              PomodoroTab: 'Pomodoro',
            };
            return <TabIcon label={labels[route.name]} focused={focused} />;
          },
        })}
      >
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ title: 'Dashboard' }}
        />
        <Tab.Screen
          name="FlashcardsTab"
          component={FlashcardsScreen}
          options={{ title: 'Flashcards' }}
        />
        <Tab.Screen
          name="QuizTab"
          component={QuizTabScreen}
          options={{ title: 'Quiz' }}
        />
        <Tab.Screen
          name="AITutorTab"
          component={AITutorTabScreen}
          options={{ title: 'AI Tutor' }}
        />
        <Tab.Screen
          name="PomodoroTab"
          component={PomodoroScreen}
          options={{ title: 'Pomodoro' }}
        />
      </Tab.Navigator>
    </SafeAreaView>
  );
}

function QuizTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <QuizScreen
      route={{ key: 'quiz-tab', name: 'Quiz', params: {} } as any}
      navigation={navigation as any}
    />
  );
}

function AITutorTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <AITutorScreen
      route={{ key: 'tutor-tab', name: 'AITutor', params: {} } as any}
      navigation={navigation as any}
    />
  );
}

export function AppNavigator() {
  const { toast } = useApp();
  const { ready, isSignedIn, skippedLogin } = useAuth();
  const showLogin = ready && !isSignedIn && !skippedLogin;

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <View style={{ flex: 1 }}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#fff' },
            headerTintColor: colors.ink,
            headerTitleStyle: { fontWeight: '800' },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          {showLogin ? (
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
          ) : (
            <>
              <Stack.Screen
                name="MainTabs"
                component={MainTabs}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Flashcards"
                component={FlashcardsScreen}
                options={{ title: 'Flashcards' }}
              />
              <Stack.Screen
                name="Study"
                component={StudyScreen}
                options={{ title: 'Study Flashcards' }}
              />
              <Stack.Screen
                name="Quiz"
                component={QuizScreen}
                options={{ title: 'Quiz Mode' }}
              />
              <Stack.Screen
                name="AITutor"
                component={AITutorScreen}
                options={{ title: 'AI Tutor' }}
              />
              <Stack.Screen
                name="Pomodoro"
                component={PomodoroScreen}
                options={{ title: 'Pomodoro' }}
              />
            </>
          )}
        </Stack.Navigator>
        <Toast message={toast.message} visible={toast.visible} />
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  safe: { flex: 1, backgroundColor: '#fff' },
  topbar: {
    height: 64,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  brandText: { fontSize: 18, fontWeight: '800', color: colors.ink },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFEEFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '800' },
  tabBar: {
    backgroundColor: '#fff',
    borderTopColor: colors.line,
    height: 64,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabLabel: { fontSize: 11, fontWeight: '700' },
});
