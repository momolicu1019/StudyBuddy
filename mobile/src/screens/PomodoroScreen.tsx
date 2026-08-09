import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { Card, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import { colors } from '../theme/colors';

const FOCUS_SECONDS = 25 * 60;

export function PomodoroScreen() {
  const { showToast, setStats } = useApp();
  const [seconds, setSeconds] = useState(FOCUS_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setRunning(false);
          showToast('Focus session complete! 🎉');
          api
            .logFocus(25)
            .then(setStats)
            .catch(() => undefined);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, setStats, showToast]);

  const label = useMemo(() => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, [seconds]);

  const progress = ((FOCUS_SECONDS - seconds) / FOCUS_SECONDS) * 100;

  return (
    <View style={styles.root}>
      <Text style={styles.h1}>◷ Pomodoro</Text>
      <Text style={styles.sub}>25 minutes focus · 5 minutes break</Text>

      <Card style={styles.card}>
        <View style={styles.clockOuter}>
          <View
            style={[
              styles.clockRing,
              {
                // Approximate conic progress with border tint + overlay fill marker
                borderColor: progress > 0 ? colors.primary : '#ECEBF7',
              },
            ]}
          >
            <View style={styles.clockInner}>
              <Text style={styles.time}>{label}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.title}>Pomodoro Study Timer</Text>
        <Text style={[styles.sub, { textAlign: 'center', marginBottom: 18 }]}>
          Stay focused, then take a short break.
        </Text>

        <View style={styles.row}>
          <PrimaryButton
            label={running ? 'Pause session' : 'Start session'}
            onPress={() => setRunning((r) => !r)}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label="Reset"
            variant="secondary"
            onPress={() => {
              setRunning(false);
              setSeconds(FOCUS_SECONDS);
            }}
            style={{ flex: 1 }}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, marginTop: 6, marginBottom: 18 },
  card: { alignItems: 'center', paddingVertical: 28 },
  clockOuter: { marginBottom: 22 },
  clockRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECEBF7',
  },
  clockInner: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { fontSize: 32, fontWeight: '800', color: colors.ink },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 6,
  },
  row: { flexDirection: 'row', gap: 10, width: '100%' },
});
