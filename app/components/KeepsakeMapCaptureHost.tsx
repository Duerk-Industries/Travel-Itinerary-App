import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import type * as NativeMap from '@maplibre/maplibre-react-native';
import type { BlogDayMapPoints } from '../../server/src/services/blogMapProjection';
import type { KeepsakeMapCapture } from '../utils/keepsakeMapCapture';
import { keepsakeImage, keepsakeMapFallback, keepsakeMapPoints } from '../utils/keepsakeMapData';
import type { KeepsakeMapCaptureHandle, KeepsakeMapCaptureHostProps } from './KeepsakeMapCaptureHost.types';
type Request = {map:BlogDayMapPoints;scope:string;finish:(image?:string) => void;timer:ReturnType<typeof setTimeout>;capturing:boolean};
const compatible = () => {try {return require('expo-constants').default.expoConfig?.extra?.nativeMapRenderer === true;} catch {return false;}};
export default forwardRef<KeepsakeMapCaptureHandle,KeepsakeMapCaptureHostProps>(function KeepsakeMapCaptureHost({enabled,scope},ref) {
  const [request,setRequest] = useState<Request|null>(null);
  const current = useRef<Request|null>(null), mapRef = useRef<NativeMap.MapViewRef|null>(null);
  const [lib,setLib] = useState<typeof NativeMap|null>(null);
  const mounted = useRef(true), scopeRef = useRef(scope); scopeRef.current = scope;
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change',state => {if (state !== 'active') current.current?.finish();});
    return () => {mounted.current = false;current.current?.finish();subscription.remove();};
  },[]);
  useEffect(() => {current.current?.finish();},[scope,enabled]);
  useImperativeHandle(ref,() => ({capture: async (map:BlogDayMapPoints) => {
    const fallback = keepsakeMapFallback(map), points = keepsakeMapPoints(map);
    if (!mounted.current || !enabled || !compatible() || AppState.currentState !== 'active' || !points.length || current.current) return fallback;
    return new Promise<KeepsakeMapCapture>(resolve => {
      const job: Request = {map,scope,capturing:false,timer:undefined as unknown as ReturnType<typeof setTimeout>,finish:(image) => {
        if (current.current !== job) return;
        clearTimeout(job.timer);current.current=null;
        if(mounted.current) {setRequest(null);setLib(null);}
        resolve({...fallback,...(image && mounted.current && scopeRef.current === scope ? {image}: {})});
      }};
      current.current=job;job.timer=setTimeout(() => job.finish(),4_000);
      try {
        // Build and DB gates are checked before requiring native code in older binaries.
        const native = require('@maplibre/maplibre-react-native') as typeof NativeMap;
        if(current.current === job) {setLib(native);setRequest(job);}
      } catch {job.finish();}
    });
  }}),[enabled,scope]);
  if (!request || !lib || request.scope !== scope) return null;
  const points = keepsakeMapPoints(request.map);
  const bounds = {ne:[Math.max(...points.map(p=>p.lng)),Math.max(...points.map(p=>p.lat))],sw:[Math.min(...points.map(p=>p.lng)),Math.min(...points.map(p=>p.lat))]};
  const capture = () => {
    const job=request;if(current.current !== job || job.capturing) return;job.capturing=true;
    void mapRef.current?.takeSnap(false).then(value => job.finish(keepsakeImage(value))).catch(() => job.finish());
  };
  return <View style={{alignItems:'center',paddingVertical:8}} testID="native-keepsake-capture">
    <Text accessibilityLiveRegion="polite">Preparing approximate map…</Text>
    <lib.MapView ref={mapRef} testID="native-keepsake-map" style={{width:320,height:200}} surfaceView={false} mapStyle="https://tiles.openfreemap.org/styles/liberty" attributionEnabled logoEnabled={false} scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
      onDidFinishRenderingMapFully={capture} onDidFailLoadingMap={() => request.finish()}>
      <lib.Camera animationDuration={0} {...(points.length > 1 ? {bounds:{...bounds,paddingTop:30,paddingBottom:30,paddingLeft:30,paddingRight:30}} : {centerCoordinate:[points[0].lng,points[0].lat],zoomLevel:11})}/>
      <lib.ShapeSource id="keepsake-areas" shape={{type:'FeatureCollection',features:points.map((p,n)=>({type:'Feature',properties:{label:String(n+1)},geometry:{type:'Point',coordinates:[p.lng,p.lat]}}))}}>
        <lib.CircleLayer id="keepsake-pins" style={{circleRadius:12,circleColor:'#2563eb',circleStrokeColor:'#ffffff',circleStrokeWidth:2}}/>
        <lib.SymbolLayer id="keepsake-numbers" style={{textField:['get','label'],textSize:12,textFont:['Noto Sans Regular'],textColor:'#ffffff'}}/>
      </lib.ShapeSource>
    </lib.MapView>
    <Text>Approximate areas · © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors</Text>
  </View>;
});
