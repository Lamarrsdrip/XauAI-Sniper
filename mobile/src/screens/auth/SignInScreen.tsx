import React,{useState} from 'react';
import {View,Image,KeyboardAvoidingView,Platform,Pressable,ScrollView,Keyboard} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack'; import {Ionicons} from '@expo/vector-icons';
import {AuthStackParamList} from '../../navigation/types'; import {Screen,Text,Button,Input,Sheet} from '../../components';
import {useTheme} from '../../theme/ThemeProvider'; import {useAppState} from '../../state/AppState'; import {api} from '../../api/client'; import {USE_MOCK_DATA} from '../../api/config';
type Props=NativeStackScreenProps<AuthStackParamList,'SignIn'>;
export const SignInScreen:React.FC<Props>=({navigation})=>{
 const {colors,spacing,radius,scheme}=useTheme(); const {signIn,loading,error}=useAppState(); const [email,setEmail]=useState('');const [password,setPassword]=useState('');
 const [forgotOpen,setForgotOpen]=useState(false);const [forgotEmail,setForgotEmail]=useState('');const [forgotSending,setForgotSending]=useState(false);const [forgotSent,setForgotSent]=useState(false);
 const forgot=async()=>{if(!forgotEmail.trim())return;setForgotSending(true);try{if(!USE_MOCK_DATA)await api.post('/cloud/auth/forgot-password',{email:forgotEmail.trim()});setForgotSent(true)}finally{setForgotSending(false)}};
 return <Screen scroll={false} edges={['top','bottom','left','right']}>
  <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1}}>
   <ScrollView contentContainerStyle={{flexGrow:1,justifyContent:'space-between',paddingTop:spacing.xl,paddingBottom:spacing.lg}} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} contentInsetAdjustmentBehavior="automatic">
   <View>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
     <Image source={require('../../../assets/icon.png')} style={{width:46,height:46,borderRadius:14}}/>
     <View style={{flexDirection:'row',alignItems:'center',gap:6}}><View style={{width:7,height:7,borderRadius:4,backgroundColor:colors.buy}}/><Text variant="micro" color="secondary" style={{letterSpacing:1}}>SECURE ACCESS</Text></View>
    </View>
    <View style={{marginTop:spacing.xxxl}}>
     <Text variant="micro" color="brand" style={{letterSpacing:2}}>XAUCLOUD COMMAND</Text>
     <Text variant="display" style={{marginTop:10,maxWidth:330}}>Your gold intelligence, always with you.</Text>
     <Text variant="body" color="secondary" style={{marginTop:10,maxWidth:330}}>Live XAUUSD intelligence, signals, automation and learning in one private workspace.</Text>
    </View>
   </View>
   <View style={{backgroundColor:colors.card,borderWidth:1,borderColor:colors.cardBorder,borderRadius:radius.xl,padding:spacing.lg,gap:spacing.md}}>
    <View><Text variant="h2">Welcome back</Text><Text variant="caption" color="secondary" style={{marginTop:3}}>Sign in to continue to Command.</Text></View>
    <Input label="Email address" autoCapitalize="none" autoComplete="email" textContentType="username" keyboardType="email-address" returnKeyType="next" value={email} onChangeText={setEmail} placeholder="name@email.com"/>
    <Input label="Password" secureToggle secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="go" value={password} onChangeText={setPassword} onSubmitEditing={()=>{Keyboard.dismiss();void signIn(email,password).catch(()=>{});}} placeholder="Enter your password"/>
    {error?<Text variant="caption" color="sell">{error}</Text>:null}
    <Pressable onPress={()=>{setForgotEmail(email);setForgotSent(false);setForgotOpen(true)}}><Text variant="captionMedium" color="brand" align="right">Forgot password?</Text></Pressable>
    <Button label="Enter XauCloud" fullWidth loading={loading} onPress={()=>{Keyboard.dismiss();void signIn(email,password).catch(()=>{});}} icon={<Ionicons name="arrow-forward" size={18} color={colors.brandOn}/>}/>
   </View>
   <View style={{flexDirection:'row',justifyContent:'center',gap:5}}><Text variant="caption" color="secondary">New to XauCloud?</Text><Text variant="captionMedium" color="brand" onPress={()=>navigation.navigate('CreateAccount')}>Create free account</Text></View>
   </ScrollView>
  </KeyboardAvoidingView>
  <Sheet visible={forgotOpen} onClose={()=>setForgotOpen(false)} title="Reset password"><View style={{gap:spacing.sm}}>{forgotSent?<Text variant="body" color="secondary">If an account exists for that email, a reset link has been sent.</Text>:<><Input label="Email" autoCapitalize="none" keyboardType="email-address" value={forgotEmail} onChangeText={setForgotEmail}/><Button label="Send reset link" fullWidth loading={forgotSending} onPress={forgot}/></>}</View></Sheet>
 </Screen>
}
