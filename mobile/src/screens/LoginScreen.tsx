import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';

type Mode = 'signin' | 'signup';

const BENEFITS = [
  { icon: '🃏', label: 'Turn PDFs and notes into flashcards' },
  { icon: '🧠', label: 'Practice with personalized quizzes' },
  { icon: '✨', label: 'Get help from your AI tutor' },
  { icon: '🍅', label: 'Stay focused with Pomodoro sessions' },
];

export function LoginScreen() {
  const { width } = useWindowDimensions();
  const showBrandPanel = width >= 850;
  const { signInWithEmail, createAccount, skipLogin } = useAuth();

  const [mode, setMode] = useState<Mode>('signup');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setMessage(null);
    setError(null);
    setPasswordError(false);
  }

  async function onSignIn() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await signInWithEmail(loginEmail, loginPassword);
      if (!result.ok) {
        setError(result.message);
        return;
      }
    } catch {
      setError('Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateAccount() {
    setBusy(true);
    setMessage(null);
    setError(null);
    setPasswordError(false);

    const name = fullName.trim();
    const email = signupEmail.trim();
    if (!name || !email || !signupPassword || !confirmPassword) {
      setError('Please complete all fields.');
      setBusy(false);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      setBusy(false);
      return;
    }
    if (signupPassword.length < 8) {
      setError('Password must contain at least 8 characters.');
      setBusy(false);
      return;
    }
    if (signupPassword !== confirmPassword) {
      setPasswordError(true);
      setBusy(false);
      return;
    }

    try {
      const result = await createAccount(name, email, signupPassword);
      if (!result.ok) {
        setError(result.message);
        return;
      }
    } catch {
      setError('Could not create account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <LinearGradient
        colors={['#F7F7FC', '#EEEDFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.page, showBrandPanel && styles.pageWide]}>
          {showBrandPanel ? (
            <LinearGradient
              colors={['#6C63FF', '#857DFF', '#A293FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.brandPanel}
            >
              <View style={styles.logoRow}>
                <View style={styles.logoLight}>
                  <Text style={styles.logoGlyphLight}>✦</Text>
                </View>
                <Text style={styles.logoTextLight}>Study Buddy AI</Text>
              </View>

              <View style={styles.brandContent}>
                <Text style={styles.brandHeadline}>
                  Study smarter.{'\n'}Not harder.
                </Text>
                <Text style={styles.brandCopy}>
                  Your AI-powered study companion for turning notes into flashcards,
                  practicing with quizzes, getting explanations, and staying focused.
                </Text>
                <View style={styles.benefits}>
                  {BENEFITS.map((item) => (
                    <View key={item.label} style={styles.benefit}>
                      <View style={styles.benefitIcon}>
                        <Text style={{ fontSize: 16 }}>{item.icon}</Text>
                      </View>
                      <Text style={styles.benefitText}>{item.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </LinearGradient>
          ) : null}

          <ScrollView
            contentContainerStyle={styles.formSide}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.card}>
              {!showBrandPanel ? (
                <View style={styles.mobileLogo}>
                  <View style={styles.logoSoft}>
                    <Text style={styles.logoGlyphSoft}>✦</Text>
                  </View>
                  <Text style={styles.mobileLogoText}>Study Buddy AI</Text>
                </View>
              ) : null}

              <View style={styles.tabs}>
                <Pressable
                  onPress={() => switchMode('signin')}
                  style={[styles.tab, mode === 'signin' && styles.tabActive]}
                >
                  <Text
                    style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}
                  >
                    Sign In
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => switchMode('signup')}
                  style={[styles.tab, mode === 'signup' && styles.tabActive]}
                >
                  <Text
                    style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}
                  >
                    Create Account
                  </Text>
                </Pressable>
              </View>

              {mode === 'signin' ? (
                <View>
                  <Text style={styles.h2}>Welcome back</Text>
                  <Text style={styles.subtitle}>
                    Sign in with the email you used to create your account.
                  </Text>

                  <View style={styles.form}>
                    <Field label="Email address">
                      <TextInput
                        value={loginEmail}
                        onChangeText={setLoginEmail}
                        placeholder="you@example.com"
                        placeholderTextColor={colors.muted}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoComplete="email"
                        style={styles.input}
                      />
                    </Field>

                    <Field label="Password">
                      <View style={styles.inputWrap}>
                        <TextInput
                          value={loginPassword}
                          onChangeText={setLoginPassword}
                          placeholder="Enter your password"
                          placeholderTextColor={colors.muted}
                          secureTextEntry={!showLoginPassword}
                          autoComplete="password"
                          style={[styles.input, styles.inputWithEye]}
                        />
                        <Pressable
                          style={styles.eye}
                          onPress={() => setShowLoginPassword((v) => !v)}
                        >
                          <Text>{showLoginPassword ? 'Hide' : 'Show'}</Text>
                        </Pressable>
                      </View>
                    </Field>

                    <View style={styles.row}>
                      <Pressable
                        style={styles.remember}
                        onPress={() => setRememberMe((v) => !v)}
                      >
                        <View
                          style={[styles.checkbox, rememberMe && styles.checkboxOn]}
                        >
                          {rememberMe ? (
                            <Text style={styles.checkMark}>✓</Text>
                          ) : null}
                        </View>
                        <Text style={styles.rememberText}>Remember me</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          setMessage(
                            'Password recovery will send a reset email in a future update.',
                          )
                        }
                      >
                        <Text style={styles.link}>Forgot password?</Text>
                      </Pressable>
                    </View>

                    {message ? (
                      <View style={styles.messageBox}>
                        <Text style={styles.messageText}>{message}</Text>
                      </View>
                    ) : null}
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}

                    <Pressable
                      style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
                      disabled={busy}
                      onPress={() => void onSignIn()}
                    >
                      {busy ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.primaryBtnText}>Sign In</Text>
                      )}
                    </Pressable>
                  </View>

                  <Text style={styles.prompt}>
                    Don't have an account?{' '}
                    <Text style={styles.link} onPress={() => switchMode('signup')}>
                      Create one
                    </Text>
                  </Text>
                </View>
              ) : (
                <View>
                  <Text style={styles.h2}>Create your account</Text>
                  <Text style={styles.subtitle}>
                    Use your email to set up a study profile on this device.
                  </Text>

                  <View style={styles.form}>
                    <Field label="Full name">
                      <TextInput
                        value={fullName}
                        onChangeText={setFullName}
                        placeholder="Your name"
                        placeholderTextColor={colors.muted}
                        autoComplete="name"
                        style={styles.input}
                      />
                    </Field>

                    <Field label="Email address">
                      <TextInput
                        value={signupEmail}
                        onChangeText={setSignupEmail}
                        placeholder="you@example.com"
                        placeholderTextColor={colors.muted}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoComplete="email"
                        style={styles.input}
                      />
                    </Field>

                    <Field label="Password">
                      <View style={styles.inputWrap}>
                        <TextInput
                          value={signupPassword}
                          onChangeText={setSignupPassword}
                          placeholder="At least 8 characters"
                          placeholderTextColor={colors.muted}
                          secureTextEntry={!showSignupPassword}
                          autoComplete="new-password"
                          style={[styles.input, styles.inputWithEye]}
                        />
                        <Pressable
                          style={styles.eye}
                          onPress={() => setShowSignupPassword((v) => !v)}
                        >
                          <Text>{showSignupPassword ? 'Hide' : 'Show'}</Text>
                        </Pressable>
                      </View>
                    </Field>

                    <Field label="Confirm password">
                      <View style={styles.inputWrap}>
                        <TextInput
                          value={confirmPassword}
                          onChangeText={(text) => {
                            setConfirmPassword(text);
                            setPasswordError(false);
                          }}
                          placeholder="Re-enter your password"
                          placeholderTextColor={colors.muted}
                          secureTextEntry={!showConfirmPassword}
                          autoComplete="new-password"
                          style={[styles.input, styles.inputWithEye]}
                        />
                        <Pressable
                          style={styles.eye}
                          onPress={() => setShowConfirmPassword((v) => !v)}
                        >
                          <Text>{showConfirmPassword ? 'Hide' : 'Show'}</Text>
                        </Pressable>
                      </View>
                      {passwordError ? (
                        <Text style={styles.fieldError}>Passwords don't match.</Text>
                      ) : null}
                    </Field>

                    {message ? (
                      <View style={styles.messageBox}>
                        <Text style={styles.messageText}>{message}</Text>
                      </View>
                    ) : null}
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}

                    <Pressable
                      style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
                      disabled={busy}
                      onPress={() => void onCreateAccount()}
                    >
                      {busy ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.primaryBtnText}>Create Account</Text>
                      )}
                    </Pressable>
                  </View>

                  <Text style={styles.terms}>
                    By creating an account, you agree to our Terms of Service and
                    Privacy Policy.
                  </Text>

                  <Text style={styles.prompt}>
                    Already have an account?{' '}
                    <Text style={styles.link} onPress={() => switchMode('signin')}>
                      Sign in
                    </Text>
                  </Text>
                </View>
              )}

              <Pressable onPress={() => void skipLogin()} style={styles.skipWrap}>
                <Text style={styles.skipText}>Continue without an account</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1 },
  pageWide: { flexDirection: 'row' },
  brandPanel: {
    flex: 1,
    paddingHorizontal: 42,
    paddingVertical: 48,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoLight: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlyphLight: { color: '#fff', fontSize: 24, fontWeight: '800' },
  logoTextLight: { color: '#fff', fontWeight: '800', fontSize: 22 },
  brandContent: { marginTop: 56, maxWidth: 520 },
  brandHeadline: {
    color: '#fff',
    fontSize: 46,
    lineHeight: 50,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 18,
  },
  brandCopy: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 28,
  },
  benefits: { gap: 13 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.17)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { color: '#fff', fontWeight: '650' as unknown as '600', fontSize: 15 },
  formSide: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E7F0',
    borderRadius: 24,
    padding: 28,
    shadowColor: '#342F69',
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 4,
  },
  mobileLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 24,
  },
  logoSoft: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EEEDFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlyphSoft: { color: colors.primary, fontSize: 20, fontWeight: '800' },
  mobileLogoText: { fontWeight: '800', color: colors.ink, fontSize: 18 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#F3F2FA',
    borderRadius: 12,
    padding: 4,
    marginBottom: 25,
  },
  tab: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  tabText: { color: colors.muted, fontWeight: '750' as unknown as '700' },
  tabTextActive: { color: colors.primary },
  h2: { marginBottom: 7, fontSize: 27, fontWeight: '800', color: colors.ink },
  subtitle: { color: colors.muted, marginBottom: 23, lineHeight: 22 },
  form: { gap: 15 },
  field: { gap: 7 },
  label: { fontSize: 13, fontWeight: '750' as unknown as '700', color: colors.ink },
  inputWrap: { position: 'relative', justifyContent: 'center' },
  input: {
    width: '100%',
    paddingVertical: 13,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: '#E7E7F0',
    borderRadius: 11,
    backgroundColor: '#fff',
    color: colors.ink,
    fontSize: 15,
  },
  inputWithEye: { paddingRight: 52 },
  eye: {
    position: 'absolute',
    right: 8,
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  remember: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#D7D5E7',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkMark: { color: '#fff', fontSize: 11, fontWeight: '800' },
  rememberText: { color: colors.muted, fontSize: 13 },
  link: { color: colors.primary, fontWeight: '700' },
  primaryBtn: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  terms: {
    fontSize: 11,
    color: colors.muted,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 18,
  },
  prompt: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 13,
    marginTop: 21,
  },
  messageBox: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#EEFAF4',
  },
  messageText: { color: '#218354', fontSize: 13, fontWeight: '650' as unknown as '600' },
  errorText: { color: colors.danger, fontSize: 12 },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: -2 },
  skipWrap: { marginTop: 18, alignItems: 'center' },
  skipText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
