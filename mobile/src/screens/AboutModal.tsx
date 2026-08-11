import Constants from 'expo-constants';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { AppModal, PrimaryButton } from '../components/ui';
import { colors } from '../theme/colors';

type Props = {
  visible: boolean;
  onClose: () => void;
};

const FALLBACK_APP_NAME = 'StudyBuddy';
const FALLBACK_VERSION = '1.0.1';
const DEVELOPER = 'Nino Jeffrey Montillano';
const RIGHTS_DATE = '08/2026';

export function AboutModal({ visible, onClose }: Props) {
  const displayName = Constants.expoConfig?.name?.trim() || FALLBACK_APP_NAME;
  const version =
    Constants.expoConfig?.version ||
    Constants.nativeAppVersion ||
    FALLBACK_VERSION;

  return (
    <AppModal visible={visible} onClose={onClose}>
      <View style={styles.hero}>
        <View style={styles.logoWrap}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.appName}>{displayName}</Text>
      </View>

      <View style={styles.details}>
        <DetailRow label="App Name" value={displayName} />
        <DetailRow label="Version" value={version} />
        <DetailRow label="Developer" value={DEVELOPER} />
        <DetailRow label="All rights reserved" value={RIGHTS_DATE} />
      </View>

      <PrimaryButton
        label="Close"
        variant="secondary"
        onPress={onClose}
        style={{ marginTop: 18 }}
      />
    </AppModal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    marginBottom: 18,
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: 88,
    height: 88,
  },
  appName: {
    marginTop: 14,
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'center',
  },
  details: {
    borderRadius: 16,
    backgroundColor: colors.purpleTint,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E4E2F4',
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  value: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
});
