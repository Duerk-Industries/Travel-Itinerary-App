/// <reference types="jest" />
/// <reference types="node" />

jest.mock('../src/db', () => ({
  getAdminSetting: jest.fn(),
  setAdminSetting: jest.fn(),
  writeAuditLog: jest.fn(),
}));

import { getAdminSetting, setAdminSetting, writeAuditLog } from '../src/db';
import {
  getItineraryPromptTemplates,
  parseInstructionMarkdown,
  updateItineraryInstructionDocuments,
} from '../src/services/itineraryInstructionService';

const mockedGetAdminSetting = getAdminSetting as jest.MockedFunction<typeof getAdminSetting>;
const mockedSetAdminSetting = setAdminSetting as jest.MockedFunction<typeof setAdminSetting>;
const mockedWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

describe('itineraryInstructionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAdminSetting.mockResolvedValue(null);
    mockedSetAdminSetting.mockResolvedValue(undefined as any);
    mockedWriteAuditLog.mockResolvedValue({} as any);
  });

  it('parses markdown into system and user prompt sections', () => {
    const template = parseInstructionMarkdown('p0', '# P0\n\n## System\n\nSystem rules\n\n## User\n\nUser task');
    expect(template).toEqual({ id: 'p0_norm', sys: 'System rules', usr: 'User task' });
  });

  it('loads checked-in markdown defaults when no admin override exists', async () => {
    const templates = await getItineraryPromptTemplates();
    expect(templates.p0.id).toBe('p0_norm');
    expect(templates.p0.sys).toContain('You normalize travel inputs');
    expect(templates.p0.usr).toContain('{{REQ_JSON}}');
  });

  it('fails open to checked-in defaults when admin settings are unavailable', async () => {
    mockedGetAdminSetting.mockRejectedValueOnce(new Error('admin_settings is unavailable'));

    const templates = await getItineraryPromptTemplates();

    expect(templates.p0.id).toBe('p0_norm');
    expect(templates.p1.id).toBe('p1_route');
    expect(templates.p4.id).toBe('p4_render_md');
  });

  it('persists admin overrides and audits the changed phases', async () => {
    await updateItineraryInstructionDocuments({
      actorId: 'admin-1',
      reason: 'Tune route prompt',
      phases: {
        p1: '# P1\n\n## System\n\nNew system\n\n## User\n\nNew user',
      },
    });

    expect(mockedSetAdminSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'itinerary_generation_instruction_documents',
        updatedBy: 'admin-1',
      })
    );
    const value = JSON.parse(mockedSetAdminSetting.mock.calls[0][0].value);
    expect(value.phases.p1.markdown).toContain('New system');
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'ADMIN_SETTING_UPDATED',
        reason: 'Tune route prompt',
        afterState: expect.objectContaining({ phases: ['p1'] }),
      })
    );
  });
});
