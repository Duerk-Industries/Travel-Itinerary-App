import React from 'react';
import { Modal, type ModalProps } from 'react-native';
import KeyboardViewport from './KeyboardViewport';

/** Native modals have their own window; they need their own keyboard boundary. */
export default function KeyboardAwareModal({ children, onRequestClose, ...props }: ModalProps) {
  return <Modal {...props} onRequestClose={onRequestClose}><KeyboardViewport independent>{children}</KeyboardViewport></Modal>;
}
