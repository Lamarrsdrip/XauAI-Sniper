import React from 'react';
import { Pressable, ActivityIndicator, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
type Variant='primary'|'secondary'|'ghost'|'destructive'; type Size='md'|'sm';
interface Props {label:string;onPress?:()=>void;variant?:Variant;size?:Size;disabled?:boolean;loading?:boolean;fullWidth?:boolean;icon?:React.ReactNode;style?:ViewStyle}
export const Button:React.FC<Props>=({label,onPress,variant='primary',size='md',disabled,loading,fullWidth,icon,style})=>{
 const {colors,radius}=useTheme(); const off=disabled||loading;
 const bg={primary:colors.brand,secondary:colors.bgElevated,ghost:'transparent',destructive:colors.sell}[variant];
 const fg={primary:colors.brandOn,secondary:colors.textPrimary,ghost:colors.textPrimary,destructive:colors.textInverse}[variant];
 return <Pressable onPress={onPress} disabled={off} style={({pressed})=>[{minHeight:size==='md'?52:40,backgroundColor:bg,borderWidth:variant==='secondary'?1:0,borderColor:colors.cardBorder,borderRadius:radius.lg,paddingHorizontal:20,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,alignSelf:fullWidth?'stretch':'flex-start',opacity:off?.48:pressed?.82:1,transform:[{scale:pressed?.985:1}]},style]}>
  {loading?<ActivityIndicator size="small" color={fg}/>:<>{icon}<Text variant={size==='md'?'bodyMedium':'captionMedium'} style={{color:fg}}>{label}</Text></>}
 </Pressable>
}