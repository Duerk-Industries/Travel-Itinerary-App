import React from 'react';
import SelectField from './SelectField';
import { payerOptions, singlePayerIds } from '../utils/payerSelection';
import { type DisplayableMember, formatMemberDisplayName } from '../utils/memberDisplay';

type Props<T extends DisplayableMember> = {
  members: readonly T[];
  value?: readonly string[];
  onChange: (ids: string[]) => void;
  formatName?: (member: T) => string;
  defaultPayerId?: string | null;
  styles: Record<string, any>;
  testID?: string;
};

export default function PayerSelect<T extends DisplayableMember>({ members, value, onChange, formatName = formatMemberDisplayName, defaultPayerId, styles, testID }: Props<T>) {
  const options = payerOptions(members, formatName);
  return <SelectField
    title="Payer" placeholder="Select payer" testID={testID} styles={styles}
    value={singlePayerIds(value, defaultPayerId)[0] ?? ''} options={options}
    disabled={!options.length}
    onChange={id => { if (id) onChange([id]); }}
  />;
}
