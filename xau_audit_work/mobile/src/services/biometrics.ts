import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const PREF_KEY = 'xaucloud.biometric_enabled';

export async function isBiometricAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

export async function getBiometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PREF_KEY)) === 'true';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(PREF_KEY, enabled ? 'true' : 'false');
}

/**
 * Unlocks an already-authenticated session with device biometrics — this
 * never substitutes for server auth. It only gates whether a valid,
 * previously-issued token (stored in SecureStore after a real password
 * login) gets read back on app launch; the token itself, and the
 * entitlements it unlocks, are still 100% server-verified on every request.
 */
export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Use password instead',
    disableDeviceFallback: false,
  });
  return result.success;
}
