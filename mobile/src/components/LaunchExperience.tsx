import React, { useEffect, useRef } from 'react';
import { Animated, Image, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** A short in-app handoff after the native splash: elegant, cancellable, and
 * never a fake long loading screen. */
export const LaunchExperience: React.FC<{ ready: boolean; onComplete: () => void }> = ({ ready, onComplete }) => {
  const { colors, scheme } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.88)).current;
  const line = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 360, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 8, tension: 70, useNativeDriver: true }),
      ]),
      Animated.timing(line, { toValue: 1, duration: 420, useNativeDriver: false }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [line, opacity, scale]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(onComplete, 1150);
    return () => clearTimeout(timer);
  }, [onComplete, ready]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', width: 370, height: 370, borderRadius: 185, backgroundColor: colors.brand, opacity: scheme === 'dark' ? 0.1 : 0.08, top: -130, right: -120 }} />
      <Animated.View style={{ opacity, transform: [{ scale }], alignItems: 'center' }}>
        <View style={{ width: 82, height: 82, borderRadius: 28, backgroundColor: colors.brandMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder }}>
          <Image source={require('../../assets/icon.png')} style={{ width: 64, height: 64, borderRadius: 20 }} resizeMode="contain" />
        </View>
        <Text variant="display" style={{ marginTop: 22, letterSpacing: -1 }}>XauCloud</Text>
        <Text variant="micro" color="brand" style={{ marginTop: 8, letterSpacing: 3 }}>COMMAND</Text>
        <Animated.View style={{ width: line.interpolate({ inputRange: [0, 1], outputRange: [0, 72] }), height: 2, borderRadius: 1, backgroundColor: colors.brand, marginTop: 20 }} />
      </Animated.View>
    </View>
  );
};
