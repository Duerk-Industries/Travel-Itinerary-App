/// <reference types="jest" />
/// <reference types="node" />
import axios from 'axios';
import { postOpenAiChatCompletion } from '../src/apis/openaiApi';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('postOpenAiChatCompletion error handling', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('enriches Axios provider errors with status and response data', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 400'), {
      name: 'AxiosError',
      response: {
        status: 400,
        data: {
          error: {
            message: "Unsupported parameter: 'max_tokens' is not supported with this model.",
          },
        },
      },
    });
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockedAxios.post.mockRejectedValueOnce(axiosError);

    await expect(
      postOpenAiChatCompletion({
        caller: 'ITINERARY_PLAN_P0_NORM',
        apiKey: 'test-openai-key',
        skipApiUsageReservation: true,
        payload: {
          model: 'gpt-5.4-mini',
          messages: [{ role: 'user', content: 'Plan a trip' }],
        },
      })
    ).rejects.toMatchObject({
      message: "OpenAI request failed with status 400: Unsupported parameter: 'max_tokens' is not supported with this model.",
      status: 400,
      responseData: axiosError.response.data,
      originalStack: axiosError.stack,
    });
  });
});
