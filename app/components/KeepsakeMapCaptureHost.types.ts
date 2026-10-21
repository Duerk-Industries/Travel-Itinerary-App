import type { BlogDayMapPoints } from '../../server/src/services/blogMapProjection';
import type { KeepsakeMapCapture } from '../utils/keepsakeMapCapture';
export type KeepsakeMapCaptureHandle = {capture: (map: BlogDayMapPoints) => Promise<KeepsakeMapCapture>};
export type KeepsakeMapCaptureHostProps = {enabled:boolean;scope:string};
