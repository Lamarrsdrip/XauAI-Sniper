import React from 'react';
import { View, ViewStyle, Pressable, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

interface Props { children: React.ReactNode; style?: ViewStyle; onPress?: () => void; padded?: boolean; }

export const Card: React.FC<Props> = ({ children, style, onPress, padded = true }) => {
  const { colors, spacing, radius, scheme } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: padded ? spacing.lg : 0,
    ...(Platform.OS === 'ios' ? { shadowColor:'#000', shadowOpacity: scheme === 'dark' ? .18 : .045, shadowRadius:14, shadowOffset:{width:0,height:5} } : { elevation: scheme === 'dark' ? 0 : 1 }),
  };
  if (onPress) return <Pressable onPress={onPress} style={({pressed})=>[base,style,pressed&&{transform:[{scale:.985}],opacity:.9}]}>{children}</Pressable>;
  return <View style={[base,style]}>{children}</View>;
};

export const SectionHeader: React.FC<{ title:string; action?:React.ReactNode }> = ({title,action}) => {
 const {spacing}=useTheme();
 return <View style={{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',marginBottom:spacing.sm,marginTop:spacing.xl}}>
   <Text variant="micro" color="tertiary" style={{letterSpacing:1.7}}>{title}</Text>{action}
 </View>;
};