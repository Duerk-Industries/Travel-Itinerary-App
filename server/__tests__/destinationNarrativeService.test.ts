import {
  getDestinationNarrative,
  getDestinationNarratives,
  renderDestinationNarrativesMarkdown,
} from '../src/services/destinationNarrativeService';

jest.mock('../src/services/wikipediaGeocodingService', () => ({
  fetchWikipediaEnrichment: jest.fn(),
}));
jest.mock('../src/services/attractionDurationEstimationService', () => ({
  fetchWikipediaSummary: jest.fn(),
}));

const { fetchWikipediaEnrichment } = jest.requireMock('../src/services/wikipediaGeocodingService') as {
  fetchWikipediaEnrichment: jest.Mock;
};
const { fetchWikipediaSummary } = jest.requireMock('../src/services/attractionDurationEstimationService') as {
  fetchWikipediaSummary: jest.Mock;
};

describe('destinationNarrativeService', () => {
  beforeEach(() => {
    fetchWikipediaEnrichment.mockReset();
    fetchWikipediaSummary.mockReset();
  });

  describe('getDestinationNarrative', () => {
    test('returns null for a blank name without calling Wikipedia', async () => {
      const result = await getDestinationNarrative('   ');
      expect(result).toBeNull();
      expect(fetchWikipediaEnrichment).not.toHaveBeenCalled();
      expect(fetchWikipediaSummary).not.toHaveBeenCalled();
    });

    test('prefers the search-based enrichment summary, requesting 3 sentences', async () => {
      fetchWikipediaEnrichment.mockResolvedValue({ summary: 'Kyoto was once the imperial capital of Japan.' });
      const result = await getDestinationNarrative('Kyoto');
      expect(result).toBe('Kyoto was once the imperial capital of Japan.');
      expect(fetchWikipediaEnrichment).toHaveBeenCalledWith('Kyoto', undefined, 3);
      expect(fetchWikipediaSummary).not.toHaveBeenCalled();
    });

    test('falls back to the exact-title summary when search enrichment finds nothing', async () => {
      fetchWikipediaEnrichment.mockResolvedValue(null);
      fetchWikipediaSummary.mockResolvedValue('Fujikawaguchiko is a town near Mount Fuji.');
      const result = await getDestinationNarrative('Fujikawaguchiko');
      expect(result).toBe('Fujikawaguchiko is a town near Mount Fuji.');
      expect(fetchWikipediaSummary).toHaveBeenCalledWith('Fujikawaguchiko', 3);
    });
  });

  describe('getDestinationNarratives', () => {
    test('dedupes case-insensitively, preserves first-seen order, and skips failures', async () => {
      fetchWikipediaEnrichment.mockImplementation(async (name: string) => {
        if (name === 'Kyoto') return { summary: 'Kyoto narrative.' };
        if (name === 'Osaka') throw new Error('network blip');
        return null;
      });
      fetchWikipediaSummary.mockResolvedValue(null);

      const result = await getDestinationNarratives(['Kyoto', 'kyoto', 'Osaka', 'Nara', '  ']);
      expect(Array.from(result.entries())).toEqual([['Kyoto', 'Kyoto narrative.']]);
      expect(fetchWikipediaEnrichment).toHaveBeenCalledTimes(3); // Kyoto, Osaka, Nara (dedup + blank skipped)
    });
  });

  describe('renderDestinationNarrativesMarkdown', () => {
    test('returns empty string when no narratives resolved', () => {
      expect(renderDestinationNarrativesMarkdown(['Kyoto'], new Map())).toBe('');
    });

    test('renders sections in destination-visiting order, not alphabetical, deduping repeats', () => {
      const narratives = new Map([
        ['Kyoto', 'Kyoto narrative.'],
        ['Osaka', 'Osaka narrative.'],
      ]);
      const markdown = renderDestinationNarrativesMarkdown(['Osaka', 'Kyoto', 'Osaka'], narratives);
      expect(markdown).toBe(
        '## Destinations\n\n### Osaka\n\nOsaka narrative.\n\n### Kyoto\n\nKyoto narrative.'
      );
    });

    test('skips destinations with no resolved narrative', () => {
      const narratives = new Map([['Kyoto', 'Kyoto narrative.']]);
      const markdown = renderDestinationNarrativesMarkdown(['Kyoto', 'Unknown Town'], narratives);
      expect(markdown).toBe('## Destinations\n\n### Kyoto\n\nKyoto narrative.');
    });
  });
});
