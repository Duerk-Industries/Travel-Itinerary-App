import React, { useEffect, useState } from 'react';
import { registerRootComponent } from 'expo';
import { Platform, SafeAreaView, StyleSheet, Text } from 'react-native';

let startupError = null;
const startupErrorListeners = new Set();

const publishStartupError = (error) => {
  startupError = error;
  startupErrorListeners.forEach((listener) => {
    try {
      listener(error);
    } catch {
      // Ignore listener failures while reporting a startup failure.
    }
  });
};

const getErrorMessage = (error) => {
  if (!error) return 'Unknown startup error';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const globalErrorUtils = globalThis.ErrorUtils;
if (globalErrorUtils && typeof globalErrorUtils.setGlobalHandler === 'function') {
  globalErrorUtils.setGlobalHandler((error, isFatal) => {
    publishStartupError(error);
    // Do not forward to React Native's native exception reporter here. The
    // preview build crash log shows NativeExceptionsManager crashing while
    // trying to report the original JavaScript exception.
    console.log('Captured JS startup error', getErrorMessage(error), isFatal ? '(fatal)' : '');
  });
}

const StartupFailure = ({ error }) => (
  <SafeAreaView style={styles.container}>
    <Text style={styles.title}>WanderBunnies could not start</Text>
    <Text style={styles.message}>{getErrorMessage(error)}</Text>
  </SafeAreaView>
);

class EntryErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App entry failed', error, info?.componentStack);
  }

  render() {
    if (this.state.error) return <StartupFailure error={this.state.error} />;
    return this.props.children;
  }
}

const Root = () => {
  const [error, setError] = useState(startupError);

  useEffect(() => {
    startupErrorListeners.add(setError);
    return () => {
      startupErrorListeners.delete(setError);
    };
  }, []);

  if (error) return <StartupFailure error={error} />;

  let AppRoot;
  try {
    AppRoot = require('./AppRoot').default;
  } catch (error) {
    publishStartupError(error);
    console.log('App root failed to load', getErrorMessage(error));
    return <StartupFailure error={error} />;
  }

  return (
    <EntryErrorBoundary>
      <AppRoot />
    </EntryErrorBoundary>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#102438',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: Platform.OS === 'ios' ? undefined : '700',
    marginBottom: 12,
  },
  message: {
    color: '#dce8f2',
    fontSize: 15,
    lineHeight: 22,
  },
});

registerRootComponent(Root);
