import { Alert, Platform } from 'react-native';
import { __resetWebAlertForTests, installWebAlert } from '../utils/crossPlatformAlert';

describe('installWebAlert', () => {
  const originalAlert = Alert.alert;
  const windowStub = { alert: jest.fn(), confirm: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    __resetWebAlertForTests();
    (globalThis as any).window = windowStub;
    Platform.OS = 'web';
    Alert.alert = originalAlert;
  });
  afterEach(() => {
    delete (globalThis as any).window;
    Alert.alert = originalAlert;
    Platform.OS = 'ios';
  });

  it('shows a title and message in a browser alert, which react-native-web would drop', () => {
    installWebAlert();
    Alert.alert('Select at least one passenger');
    Alert.alert('Unable to update flight', 'Try again.');
    expect(windowStub.alert).toHaveBeenNthCalledWith(1, 'Select at least one passenger');
    expect(windowStub.alert).toHaveBeenNthCalledWith(2, 'Unable to update flight\n\nTry again.');
  });

  it('runs the only button after a plain alert', () => {
    installWebAlert();
    const onPress = jest.fn();
    Alert.alert('Saved', undefined, [{ text: 'OK', onPress }]);
    expect(windowStub.alert).toHaveBeenCalledWith('Saved');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('turns a cancel/confirm pair into a confirm dialog that runs the right callback', () => {
    installWebAlert();
    const cancel = jest.fn();
    const remove = jest.fn();
    const buttons = [{ text: 'Cancel', style: 'cancel' as const, onPress: cancel }, { text: 'Delete', style: 'destructive' as const, onPress: remove }];
    windowStub.confirm.mockReturnValueOnce(true);
    Alert.alert('Delete transfer?', 'This cannot be undone.', buttons);
    expect(windowStub.confirm).toHaveBeenCalledWith('Delete transfer?\n\nThis cannot be undone.');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();

    windowStub.confirm.mockReturnValueOnce(false);
    Alert.alert('Delete transfer?', undefined, buttons);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('is installed once and leaves native alerts alone', () => {
    installWebAlert();
    const installed = Alert.alert;
    installWebAlert();
    expect(Alert.alert).toBe(installed);

    __resetWebAlertForTests();
    Alert.alert = originalAlert;
    Platform.OS = 'ios';
    installWebAlert();
    expect(Alert.alert).toBe(originalAlert);
  });
});
