import { useCallback, useMemo, useRef, useState } from 'react';

// Closes a text input's suggestion list when the input loses focus, leaving the typed text alone.
// On web, blur fires on mouse-down before the option's press completes, so options spread
// `optionPressProps` to keep the list mounted long enough for the press to land.
export function useDropdownDismissOnBlur() {
  const [open, setOpen] = useState(true);
  const optionPressedRef = useRef(false);

  const showDropdown = useCallback(() => setOpen(true), []);
  const handleBlur = useCallback(() => {
    if (!optionPressedRef.current) setOpen(false);
  }, []);
  const optionPressProps = useMemo(
    () => ({
      onPressIn: () => { optionPressedRef.current = true; },
      onPressOut: () => { optionPressedRef.current = false; },
    }),
    []
  );

  return { open, showDropdown, handleBlur, optionPressProps };
}
