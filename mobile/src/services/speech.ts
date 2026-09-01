import { Platform } from 'react-native';

/** Android's native Speech API has no reliable pause/resume support. */
export const supportsSpeechPause = Platform.OS !== 'android';

type ExpoSpeech = typeof import('expo-speech');

/**
 * A preview/development client can be older than the JavaScript bundle. Keep
 * the app usable in that situation instead of crashing the entire navigator
 * when the newly added native module is absent. Fresh EAS builds include it.
 */
function getSpeech(): ExpoSpeech | null {
  try {
    // Deliberately lazy: importing expo-speech at navigator load time throws
    // on an already-installed binary created before this native dependency.
    return require('expo-speech') as ExpoSpeech;
  } catch {
    return null;
  }
}

export function isSpeechAvailable(): boolean {
  return getSpeech() !== null;
}

export function stopReading(): void {
  getSpeech()?.stop();
}

export function pauseReading(): void {
  if (supportsSpeechPause) getSpeech()?.pause();
}

export function resumeReading(): void {
  if (supportsSpeechPause) getSpeech()?.resume();
}

export function readLesson(text: string, onDone: () => void, rate = 0.9): boolean {
  const speech = getSpeech();
  if (!speech) return false;
  speech.stop();
  speech.speak(text, {
    language: 'en-US',
    rate,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
  return true;
}
