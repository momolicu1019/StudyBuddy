import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Toast } from '../components/ui';
import { useApp } from '../context/AppContext';
import { useAuth, useAuthInitials } from '../context/AuthContext';
import { AboutModal } from '../screens/AboutModal';
import { AccountModal } from '../screens/AccountModal';
import { AITutorScreen } from '../screens/AITutorScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { DeadlinesScreen } from '../screens/DeadlinesScreen';
import { FlashcardsScreen } from '../screens/FlashcardsScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { PomodoroScreen } from '../screens/PomodoroScreen';
import { QuizScreen } from '../screens/QuizScreen';
import { StudyScreen } from '../screens/StudyScreen';
import { TypeNotesScreen } from '../screens/TypeNotesScreen';
import { colors } from '../theme/colors';
import type { MainTabParamList, RootStackParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_META: Record<
  keyof MainTabParamList,
  { title: string; icon: IoniconName; iconFocused: IoniconName }
> = {
  Dashboard: {
    title: 'Home',
    icon: 'home-outline',
    iconFocused: 'home',
  },
  FlashcardsTab: {
    title: 'Cards',
    icon: 'albums-outline',
    iconFocused: 'albums',
  },
  QuizTab: {
    title: 'Quiz',
    icon: 'checkbox-outline',
    iconFocused: 'checkbox',
  },
  AITutorTab: {
    title: 'Tutor',
    icon: 'sparkles-outline',
    iconFocused: 'sparkles',
  },
  PomodoroTab: {
    title: 'Focus',
    icon: 'timer-outline',
    iconFocused: 'timer',
  },
};

function BrandHeader() {
  const initials = useAuthInitials();
  const [accountOpen, setAccountOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <View style={styles.topbar}>
        <Pressable
          style={styles.brand}
          onPress={() => setAboutOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="About Study Buddy AI"
        >
          <View style={styles.logo}>
            <Text style={styles.logoText}>✦</Text>
          </View>
          <Text style={styles.brandText}>Study Buddy AI</Text>
        </Pressable>
        <Pressable style={styles.avatar} onPress={() => setAccountOpen(true)}>
          <Text style={styles.avatarText}>{initials}</Text>
        </Pressable>
      </View>
      <AccountModal visible={accountOpen} onClose={() => setAccountOpen(false)} />
      <AboutModal visible={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}

function TabIcon({
  routeName,
  focused,
}: {
  routeName: keyof MainTabParamList;
  focused: boolean;
}) {
  const meta = TAB_META[routeName];
  return (
    <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
      <Ionicons
        name={focused ? meta.iconFocused : meta.icon}
        size={20}
        color={focused ? colors.primary : colors.muted}
      />
    </View>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 10 : 8);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BrandHeader />
      <Tab.Navigator
        screenOptions={({ route }) => {
          const meta = TAB_META[route.name as keyof MainTabParamList];
          return {
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.muted,
            tabBarHideOnKeyboard: true,
            tabBarStyle: [
              styles.tabBar,
              {
                height: 58 + bottomPad,
                paddingBottom: bottomPad,
              },
            ],
            tabBarItemStyle: styles.tabItem,
            tabBarLabelStyle: styles.tabLabel,
            tabBarLabel: meta.title,
            tabBarIcon: ({ focused }) => (
              <TabIcon
                routeName={route.name as keyof MainTabParamList}
                focused={focused}
              />
            ),
          };
        }}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} />
        <Tab.Screen name="FlashcardsTab" component={FlashcardsScreen} />
        <Tab.Screen name="QuizTab" component={QuizTabScreen} />
        <Tab.Screen name="AITutorTab" component={AITutorTabScreen} />
        <Tab.Screen name="PomodoroTab" component={PomodoroScreen} />
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
          key={showLogin ? 'auth' : 'app'}
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
                name="TypeNotes"
                component={TypeNotesScreen}
                options={{ title: 'Type Notes' }}
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
                name="Deadlines"
                component={DeadlinesScreen}
                options={{ title: 'Deadlines and Due Date' }}
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
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#ECEAF5',
    paddingTop: 8,
    elevation: 12,
    shadowColor: '#1B1840',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  tabItem: {
    paddingTop: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: 0.2,
  },
  tabIconWrap: {
    width: 42,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconWrapActive: {
    backgroundColor: colors.primarySoft,
  },
});
