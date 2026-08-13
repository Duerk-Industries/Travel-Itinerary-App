import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { SecretProvider } from '../ports/SecretProvider';

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: 'sandbox' | 'development' | 'production';
}

export const buildPlaidClient = async (secretProvider: SecretProvider): Promise<PlaidApi> => {
  const clientId = await secretProvider.getSecret('PLAID_CLIENT_ID');
  const env = (await secretProvider.getSecret('PLAID_ENV')) as 'sandbox' | 'development' | 'production';
  const secret = await secretProvider.getSecret(`PLAID_SECRET_${env.toUpperCase()}`);

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(configuration);
};
