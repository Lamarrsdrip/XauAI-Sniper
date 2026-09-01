import React,{useState} from 'react';
import {TextInput,TextInputProps,View,Pressable} from 'react-native';
import {useTheme} from '../theme/ThemeProvider'; import {Text} from './Text'; import {Ionicons} from '@expo/vector-icons';
interface Props extends TextInputProps{label?:string;error?:string;secureToggle?:boolean}
export const Input:React.FC<Props>=({label,error,secureToggle,secureTextEntry,style,...rest})=>{
 const {colors,radius}=useTheme(); const [hidden,setHidden]=useState(!!secureTextEntry); const [focus,setFocus]=useState(false);
 return <View style={{gap:7}}>
  {label?<Text variant="micro" color="secondary" style={{letterSpacing:.8,textTransform:'uppercase'}}>{label}</Text>:null}
  <View style={{minHeight:56,flexDirection:'row',alignItems:'center',backgroundColor:colors.inputBg,borderWidth:1,borderColor:error?colors.sell:focus?colors.brand:colors.inputBorder,borderRadius:radius.lg,paddingHorizontal:16}}>
   <TextInput placeholderTextColor={colors.textTertiary} secureTextEntry={secureToggle?hidden:secureTextEntry} onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)} style={[{flex:1,paddingVertical:14,fontSize:16,color:colors.textPrimary},style]} {...rest}/>
   {secureToggle&&<Pressable onPress={()=>setHidden(x=>!x)} hitSlop={10}><Ionicons name={hidden?'eye-outline':'eye-off-outline'} size={20} color={colors.textTertiary}/></Pressable>}
  </View>{error?<Text variant="caption" color="sell">{error}</Text>:null}
 </View>
}