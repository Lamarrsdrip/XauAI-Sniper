import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Ionicons} from '@expo/vector-icons'; import {useTheme} from '../theme/ThemeProvider';
import {HomeNavigator,TradingNavigator,ActivityNavigator,AcademyNavigator,MoreNavigator} from './stacks';
const Tab=createBottomTabNavigator();
const icons:any={HomeTab:['home','home-outline'],TradingTab:['pulse','pulse-outline'],ActivityTab:['analytics','analytics-outline'],LearnTab:['school','school-outline'],MoreTab:['grid','grid-outline']};
const labels:any={HomeTab:'Home',TradingTab:'Trade',ActivityTab:'Activity',LearnTab:'Academy',MoreTab:'More'};
export const MainTabs:React.FC=()=>{const {colors}=useTheme();return <Tab.Navigator screenOptions={({route})=>({headerShown:false,tabBarActiveTintColor:colors.brand,tabBarInactiveTintColor:colors.textTertiary,tabBarLabel:labels[route.name],tabBarLabelStyle:{fontSize:11,fontWeight:'600',marginTop:2},tabBarStyle:{height:72,paddingTop:8,paddingBottom:10,backgroundColor:colors.tabBarBg,borderTopColor:colors.tabBarBorder,borderTopWidth:1},tabBarIcon:({focused,color})=><Ionicons name={icons[route.name][focused?0:1]} size={22} color={color}/>})}>
 <Tab.Screen name="HomeTab" component={HomeNavigator}/><Tab.Screen name="TradingTab" component={TradingNavigator}/><Tab.Screen name="ActivityTab" component={ActivityNavigator}/><Tab.Screen name="LearnTab" component={AcademyNavigator}/><Tab.Screen name="MoreTab" component={MoreNavigator}/>
 </Tab.Navigator>}