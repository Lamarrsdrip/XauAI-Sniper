/**
 * Native-stack back works for ordinary in-app navigation, but a screen opened
 * straight from a deep link may be the first route in its stack. Always give
 * customers an explicit, predictable exit in that case.
 */
export function goBackOrNavigate(navigation: any, fallbackRoute: string): void {
  if (navigation?.canGoBack?.()) {
    navigation.goBack();
    return;
  }
  navigation?.navigate?.(fallbackRoute);
}
