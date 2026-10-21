import type { ReactNode } from 'react';
export type DayOrderRowProps = {
  id: string; name: string; disabled: boolean; children: ReactNode;
  onStart: (id: string) => void;
  onDrop: (id: string) => void;
  onEnd: (offset?: number) => void;
  onLayout: (id: string, y: number, height: number) => void;
};
