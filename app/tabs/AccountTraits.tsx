import React from 'react';
import { View } from 'react-native';
import { TraitsTab, type Trait } from './traits';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type Styles = Record<string, any>;
type Headers = Record<string, string>;

interface AccountTraitsProps {
  backendUrl: string;
  userToken: string | null;
  headers: Headers;
  jsonHeaders: Headers;
  traits: Trait[];
  setTraits: Setter<Trait[]>;
  selectedTraitNames: Set<string>;
  setSelectedTraitNames: Setter<Set<string>>;
  traitAge: string;
  setTraitAge: Setter<string>;
  traitGender: 'female' | 'male' | 'nonbinary' | 'prefer-not';
  setTraitGender: Setter<'female' | 'male' | 'nonbinary' | 'prefer-not'>;
  newTraitName: string;
  setNewTraitName: Setter<string>;
  fetchTraits: () => Promise<void>;
  fetchTraitProfile: () => Promise<void>;
  styles: Styles;
}

const AccountTraits: React.FC<AccountTraitsProps> = (props) => {
  return (
    <View style={props.styles.card}>
      <TraitsTab
        {...props}
      />
    </View>
  );
};

export default AccountTraits;