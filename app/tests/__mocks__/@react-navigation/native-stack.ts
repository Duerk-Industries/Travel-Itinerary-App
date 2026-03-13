import React from 'react';

export const createNativeStackNavigator = () => {
  const Navigator = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const Screen = ({ children }: { children?: React.ReactNode | (() => React.ReactNode) }) => {
    if (typeof children === 'function') {
      return React.createElement(React.Fragment, null, children());
    }
    return React.createElement(React.Fragment, null, children ?? null);
  };
  const Group = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return { Navigator, Screen, Group };
};
