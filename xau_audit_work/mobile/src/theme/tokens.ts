/**
 * XauCloud mobile design tokens.
 * Gold is a brand/accent color only — it is never used as a page background
 * or applied indiscriminately. Semantic colors (buy/sell/info/warn) carry
 * their own identity independent of brand color.
 */

export const palette = {
  white: '#FFFFFF',
  black: '#0A0A0B',

  // Neutral warm-off-white scale for light mode
  n0: '#FFFFFF',
  n25: '#FAFAF9',
  n50: '#F5F4F2',
  n100: '#EDECE9',
  n200: '#E1DFDB',
  n300: '#C9C6C0',
  n400: '#A6A29A',
  n500: '#847F76',
  n600: '#635F58',
  n700: '#48453F',
  n800: '#2D2B27',
  n900: '#1C1B18',

  // Deep graphite/navy scale for dark mode (never pure black surfaces)
  d0: '#0B0D10',
  d50: '#111418',
  d100: '#161A1F',
  d150: '#1B2027',
  d200: '#212730',
  d300: '#2B323C',
  d400: '#3A424D',
  d500: '#565F6B',
  d600: '#7C8592',
  d700: '#A5ACB6',
  d800: '#CBD0D6',
  d900: '#EEF0F2',

  // Brand gold — accent only
  gold50: '#FBF4E4',
  gold200: '#EFD495',
  gold400: '#D9A93C',
  gold500: '#BF8F26',
  gold600: '#9C7419',
  gold700: '#7A5A12',

  // Semantic: buy / positive
  green400: '#3BC17A',
  green500: '#1FA05F',
  green600: '#178049',
  greenBgLight: '#E8F7EF',
  greenBgDark: '#122A20',

  // Semantic: sell / negative
  red400: '#F0594F',
  red500: '#DC3A30',
  red600: '#B32B23',
  redBgLight: '#FCEAE8',
  redBgDark: '#301715',

  // Semantic: info / links
  blue400: '#4C8DF0',
  blue500: '#2E6FDB',
  blue600: '#2258B8',
  blueBgLight: '#E8F0FD',
  blueBgDark: '#132234',

  // Semantic: amber warning (distinct from brand gold, slightly redder)
  amber400: '#F0A63E',
  amber500: '#D6862A',
  amberBgLight: '#FCF1E1',
  amberBgDark: '#332615',
} as const;

export type ThemeName = 'light' | 'dark';

export interface ThemeColors {
  // Surfaces
  bg: string;
  bgElevated: string;
  card: string;
  cardBorder: string;
  overlay: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  textOnBrand: string;

  // Brand
  brand: string;
  brandMuted: string;
  brandOn: string;

  // Semantic
  buy: string;
  buyBg: string;
  sell: string;
  sellBg: string;
  info: string;
  infoBg: string;
  warn: string;
  warnBg: string;

  // Structural
  divider: string;
  disabled: string;
  disabledBg: string;
  inputBg: string;
  inputBorder: string;
  tabBarBg: string;
  tabBarBorder: string;
  skeleton: string;
}

export const lightColors: ThemeColors = {
  bg: palette.n25,
  bgElevated: palette.white,
  card: palette.white,
  cardBorder: palette.n100,
  overlay: 'rgba(20,18,14,0.45)',

  textPrimary: palette.n900,
  textSecondary: palette.n600,
  textTertiary: palette.n500,
  textInverse: palette.white,
  textOnBrand: palette.n900,

  brand: palette.gold500,
  brandMuted: palette.gold50,
  brandOn: palette.n900,

  buy: palette.green600,
  buyBg: palette.greenBgLight,
  sell: palette.red600,
  sellBg: palette.redBgLight,
  info: palette.blue600,
  infoBg: palette.blueBgLight,
  warn: palette.amber500,
  warnBg: palette.amberBgLight,

  divider: palette.n100,
  disabled: palette.n400,
  disabledBg: palette.n50,
  inputBg: palette.white,
  inputBorder: palette.n200,
  tabBarBg: palette.white,
  tabBarBorder: palette.n100,
  skeleton: palette.n100,
};

export const darkColors: ThemeColors = {
  bg: palette.d0,
  bgElevated: palette.d100,
  card: palette.d150,
  cardBorder: palette.d300,
  overlay: 'rgba(0,0,0,0.6)',

  textPrimary: palette.d900,
  textSecondary: palette.d700,
  textTertiary: palette.d600,
  textInverse: palette.n900,
  textOnBrand: palette.n900,

  brand: palette.gold400,
  brandMuted: '#241D0F',
  brandOn: palette.n900,

  buy: palette.green400,
  buyBg: palette.greenBgDark,
  sell: palette.red400,
  sellBg: palette.redBgDark,
  info: palette.blue400,
  infoBg: palette.blueBgDark,
  warn: palette.amber400,
  warnBg: palette.amberBgDark,

  divider: palette.d300,
  disabled: palette.d500,
  disabledBg: palette.d150,
  inputBg: palette.d150,
  inputBorder: palette.d300,
  tabBarBg: palette.d50,
  tabBarBorder: palette.d300,
  skeleton: palette.d200,
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' as const },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  h3: { fontSize: 15, lineHeight: 20, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, lineHeight: 21, fontWeight: '500' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  captionMedium: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const },
  numeric: { fontSize: 26, lineHeight: 30, fontWeight: '700' as const },
  numericSm: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
} as const;

export const shadow = {
  none: {},
  sm: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
} as const;
