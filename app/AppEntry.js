// Required by Expo SDK 50+ for web HMR / fast refresh and async route support.
// Safe to import on every platform; the native runtime no-ops.
import '@expo/metro-runtime';
import React, { useEffect, useState } from 'react';
import { registerRootComponent } from 'expo';
import { Platform, StyleSheet, Text, StatusBar, View } from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';

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
  if (!globalErrorUtils.__hasWanderBunniesHandler) {
    const originalGlobalHandler = typeof globalErrorUtils.getGlobalHandler === 'function' 
      ? globalErrorUtils.getGlobalHandler() 
      : null;

    globalErrorUtils.setGlobalHandler((error, isFatal) => {
      if (!globalThis.__wanderBunniesAppMounted) {
        publishStartupError(error);
        console.log('Captured JS startup error', getErrorMessage(error), isFatal ? '(fatal)' : '');
      } else if (originalGlobalHandler) {
        originalGlobalHandler(error, isFatal);
      } else {
        console.error('Unhandled JS error:', getErrorMessage(error));
      }
    });
    globalErrorUtils.__hasWanderBunniesHandler = true;
  }
}

const StartupFailure = ({ error }) => (
  <SafeAreaProvider>
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>WanderBunnies could not start</Text>
        <Text style={styles.message}>{getErrorMessage(error)}</Text>
      </View>
    </SafeAreaView>
  </SafeAreaProvider>
);

const describeModuleShape = (moduleValue) => {
  const t = typeof moduleValue;
  if (moduleValue === null) return 'null';
  if (moduleValue === undefined) return 'undefined';
  if (t === 'function') return `function name=${moduleValue.name || '(anon)'}`;
  if (t !== 'object') return `${t}:${String(moduleValue)}`;
  try {
    const keys = Object.keys(moduleValue);
    const defaultDesc = 'default' in moduleValue
      ? ` default=${typeof moduleValue.default}`
      : '';
    return `object keys=[${keys.join(',') || 'none'}]${defaultDesc}`;
  } catch (e) {
    return `object inspect-error:${e && e.message}`;
  }
};

const isReactComponent = (value) => {
  if (typeof value === 'function') return true;
  if (value && typeof value === 'object' && typeof value.$$typeof === 'symbol') return true;
  return false;
};

const resolveComponentExport = (moduleValue) => {
  let current = moduleValue;
  for (let depth = 0; depth < 5; depth += 1) {
    if (isReactComponent(current)) return current;
    if (!current || typeof current !== 'object' || !('default' in current)) break;
    current = current.default;
  }
  return isReactComponent(current) ? current : null;
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
    globalThis.__wanderBunniesAppMounted = true;
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
  safeArea: {
    flex: 1,
    backgroundColor: '#102438',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 24 : 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  message: {
    color: '#dce8f2',
    fontSize: 15,
    lineHeight: 22,
  },
});

registerRootComponent(Root);
