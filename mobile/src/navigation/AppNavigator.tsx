import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import { Toast } from '../components/ui';
import { useApp } from '../context/AppContext';
import { useAuth, useAuthInitials } from '../context/AuthContext';
import {
  ensureChatSession,
  isChatApiConfigured,
  registerChatPushForCurrentUser,
  subscribeUnreadTotal,
} from '../api/chatApi';
import {
  ensureChatNotificationHandler,
  parseChatNotificationData,
  type ChatNotificationData,
} from '../api/chatNotifications';
import { AboutModal } from '../screens/AboutModal';
import { AccountModal } from '../screens/AccountModal';
import { AITutorScreen } from '../screens/AITutorScreen';
import { ChatThreadScreen } from '../screens/ChatThreadScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { DeadlinesScreen } from '../screens/DeadlinesScreen';
import { FlashcardsScreen } from '../screens/FlashcardsScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
import { PomodoroScreen } from '../screens/PomodoroScreen';
import { ProgressScreen } from '../screens/ProgressScreen';
import { QuizScreen } from '../screens/QuizScreen';
import { StorageScreen } from '../screens/StorageScreen';
import { StudyScreen } from '../screens/StudyScreen';
import { TypeNotesScreen } from '../screens/TypeNotesScreen';
import { isDeadlineNotificationResponse } from '../storage/deadlineNotifications';
import { colors } from '../theme/colors';
import type { MainTabParamList, RootStackParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

function openDeadlinesFromNotification() {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Deadlines');
}

function openChatFromNotification(data: ChatNotificationData) {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('ChatThread', {
    conversationId: data.conversationId,
    peerName: data.peerName || 'Chat',
    peerEmail: data.peerEmail || '',
    isGroup: data.isGroup === true,
  });
}

function notificationDataFromResponse(raw: unknown): unknown {
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    // Some Android builds expose the payload as `dataString` instead of `data`.
    if (
      (record.data == null || Object.keys(record.data as object).length === 0) &&
      typeof record.dataString === 'string'
    ) {
      try {
        return JSON.parse(record.dataString);
      } catch {
        return raw;
      }
    }
  }
  return raw;
}

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
  const { session, isSignedIn, skippedLogin } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);

  const canChat = isSignedIn && !skippedLogin && Boolean(session?.user);

  useEffect(() => {
    if (!canChat || !session?.user || !isChatApiConfigured()) {
      setUnreadTotal(0);
      return;
    }

    let unsub: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        await ensureChatSession({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        });
        if (cancelled) return;
        void registerChatPushForCurrentUser();
        unsub = subscribeUnreadTotal(
          (total) => {
            if (!cancelled) setUnreadTotal(total);
          },
          () => {
            if (!cancelled) setUnreadTotal(0);
          },
        );
      } catch {
        if (!cancelled) setUnreadTotal(0);
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [canChat, session?.user?.id, session?.user?.email, session?.user?.name]);

  const unreadLabel =
    unreadTotal > 99 ? '99+' : unreadTotal > 0 ? String(unreadTotal) : null;

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
        <View style={styles.headerActions}>
          <Pressable
            style={styles.chatBtn}
            onPress={() => {
              if (navigationRef.isReady()) navigationRef.navigate('Messages');
            }}
            accessibilityRole="button"
            accessibilityLabel={
              unreadLabel
                ? `Messages, ${unreadTotal} unread`
                : 'Messages'
            }
          >
            <Ionicons name="chatbubbles-outline" size={22} color={colors.primary} />
            {unreadLabel ? (
              <View style={styles.chatBadge}>
                <Text style={styles.chatBadgeText}>{unreadLabel}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable style={styles.avatar} onPress={() => setAccountOpen(true)}>
            <Text style={styles.avatarText}>{initials}</Text>
          </Pressable>
        </View>
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
  const pendingDeadlineTap = useRef(false);
  const pendingChatTap = useRef<ChatNotificationData | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Ensure foreground banners work even before Messages is opened.
    ensureChatNotificationHandler();

    const handleResponseData = (data: unknown) => {
      const chat = parseChatNotificationData(notificationDataFromResponse(data));
      if (chat) {
        if (navigationRef.isReady() && !showLogin) {
          openChatFromNotification(chat);
        } else {
          pendingChatTap.current = chat;
        }
        return;
      }
      if (isDeadlineNotificationResponse(data)) {
        if (navigationRef.isReady() && !showLogin) {
          openDeadlinesFromNotification();
        } else {
          pendingDeadlineTap.current = true;
        }
      }
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const content = response.notification.request.content as {
          data?: unknown;
          dataString?: string;
        };
        handleResponseData(
          content.data ??
            (content.dataString ? { dataString: content.dataString } : null),
        );
      },
    );

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const content = response?.notification.request.content as
        | { data?: unknown; dataString?: string }
        | undefined;
      handleResponseData(
        content?.data ??
          (content?.dataString ? { dataString: content.dataString } : null),
      );
    });

    return () => {
      responseSub.remove();
    };
  }, [showLogin]);

  useEffect(() => {
    if (showLogin || !pendingDeadlineTap.current) return;
    const timer = setTimeout(() => {
      if (!pendingDeadlineTap.current) return;
      pendingDeadlineTap.current = false;
      openDeadlinesFromNotification();
    }, 350);
    return () => clearTimeout(timer);
  }, [showLogin, ready]);

  useEffect(() => {
    if (showLogin || !pendingChatTap.current) return;
    const pending = pendingChatTap.current;
    const timer = setTimeout(() => {
      if (!pendingChatTap.current) return;
      pendingChatTap.current = null;
      openChatFromNotification(pending);
    }, 350);
    return () => clearTimeout(timer);
  }, [showLogin, ready]);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
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
                name="Progress"
                component={ProgressScreen}
                options={{ title: 'My Progress' }}
              />
              <Stack.Screen
                name="Storage"
                component={StorageScreen}
                options={{ title: 'Storage' }}
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
              <Stack.Screen
                name="Messages"
                component={MessagesScreen}
                options={{ title: 'Messages' }}
              />
              <Stack.Screen
                name="ChatThread"
                component={ChatThreadScreen}
                options={({ route }) => ({
                  title: route.params.peerName || 'Chat',
                })}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBadgeText: {
    color: '#FF0000',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },
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
