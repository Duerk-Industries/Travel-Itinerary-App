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

const describeModuleShape = (moduleValue) => {
  if (moduleValue == null) return String(moduleValue);
  if (typeof moduleValue !== 'object') return typeof moduleValue;
  try {
    return `object keys: ${Object.keys(moduleValue).join(', ') || '(none)'}`;
  } catch {
    return 'object keys unavailable';
  }
};

const resolveComponentExport = (moduleValue) => {
  let current = moduleValue;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current === 'function') return current;
    if (!current || typeof current !== 'object' || !('default' in current)) break;
    current = current.default;
  }
  return typeof current === 'function' ? current : null;
};

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
    const appRootModule = require('./AppRoot');
    AppRoot = resolveComponentExport(appRootModule);
    if (!AppRoot) {
      throw new Error(`AppRoot module did not export a React component (${describeModuleShape(appRootModule)}).`);
    }
  } catch (loadError) {
    publishStartupError(loadError);
    console.log('App root failed to load', getErrorMessage(loadError));
    return <StartupFailure error={loadError} />;
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
