import React, { forwardRef, useImperativeHandle } from 'react';
import { captureKeepsakeMap } from '../utils/keepsakeMapCapture';
import type { KeepsakeMapCaptureHandle, KeepsakeMapCaptureHostProps } from './KeepsakeMapCaptureHost.types';
export default forwardRef<KeepsakeMapCaptureHandle,KeepsakeMapCaptureHostProps>(function KeepsakeMapCaptureHost(_props,ref) {
  useImperativeHandle(ref,() => ({capture:captureKeepsakeMap}),[]); return null;
});
