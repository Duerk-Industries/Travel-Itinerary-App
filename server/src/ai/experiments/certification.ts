import { getAiProviderCertification } from '../../db';
import { getRegisteredAiProviders } from '../registry/aiProviderRegistry';

export const isProviderCertified = async (providerId: string): Promise<boolean> => {
  const registered = getRegisteredAiProviders().some((provider) => provider.id === providerId);
  if (!registered) return false;
  return Boolean(await getAiProviderCertification(providerId));
};
