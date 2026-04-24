import React, { memo, useCallback, useEffect, useState } from 'react';
import { TextInput } from 'react-native';

type DraftTextInputProps = Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (value: string) => void;
  commitOnBlur?: boolean;
};

const DraftTextInputComponent: React.FC<DraftTextInputProps> = ({
  value,
  onChangeText,
  commitOnBlur = true,
  onBlur,
  ...props
}) => {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(
    (nextValue: string) => {
      if (nextValue !== value) onChangeText(nextValue);
    },
    [onChangeText, value]
  );

  const handleChangeText = useCallback(
    (nextValue: string) => {
      setDraft(nextValue);
      if (!commitOnBlur) onChangeText(nextValue);
    },
    [commitOnBlur, onChangeText]
  );

  const handleBlur = useCallback(
    (event: any) => {
      if (commitOnBlur) commit(draft);
      onBlur?.(event);
    },
    [commit, commitOnBlur, draft, onBlur]
  );

  return <TextInput {...props} value={draft} onChangeText={handleChangeText} onBlur={handleBlur} />;
};

const DraftTextInput = memo(DraftTextInputComponent);

export default DraftTextInput;
