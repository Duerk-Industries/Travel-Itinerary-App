import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import BlogPublicationChecklist, { readinessLines, type BlogPublicationReadiness } from '../components/BlogPublicationChecklist';

const ready: BlogPublicationReadiness = {
  state: 'private', optedOut: false, tripStarted: true, goLiveDate: '2027-05-01', missingBirthDate: 0, selfMissingBirthDate: false,
  underAge: 0, privateDefaultCount: 0, altTextIssueCount: 0, ready: true,
};

describe('readinessLines', () => {
  it('marks everything done when nothing blocks publishing', () => {
    expect(readinessLines(ready).every((line) => line.ok)).toBe(true);
  });

  it('says when the blog goes live for a trip that has not started', () => {
    const [start] = readinessLines({ ...ready, tripStarted: false });
    expect(start).toMatchObject({ ok: false });
    expect(start.text).toContain('2027-05-01');
  });

  it('asks the viewer to add their own date of birth, and counts photos missing alt text', () => {
    const lines = readinessLines({ ...ready, missingBirthDate: 2, selfMissingBirthDate: true, altTextIssueCount: 3, ready: false });
    expect(lines.find((line) => line.key === 'dob')?.text).toContain('Add your date of birth');
    expect(lines.find((line) => line.key === 'alt')?.text).toBe('3 public photos need alt text or a decorative mark.');
  });
});

describe('BlogPublicationChecklist', () => {
  afterEach(() => { (global as any).fetch = undefined; });

  it('loads readiness for the trip and shows one line per requirement', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...ready, tripStarted: false, ready: false }) });
    (global as any).fetch = fetchMock;
    const { findByTestId, getByTestId } = render(
      <BlogPublicationChecklist tripId="trip-1" backendUrl="http://api" headers={{ Authorization: 'Bearer t' }} styles={{}} />
    );
    await findByTestId('blog-publication-checklist');
    expect(fetchMock).toHaveBeenCalledWith('http://api/api/trips/trip-1/blog/publication/readiness', { headers: { Authorization: 'Bearer t' } });
    expect(getByTestId('blog-publication-check-start').props.accessibilityLabel).toMatch(/^To do:/);
    expect(getByTestId('blog-publication-check-alt').props.accessibilityLabel).toMatch(/^Done:/);
  });

  it('renders nothing when the endpoint is unavailable', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false });
    (global as any).fetch = fetchMock;
    const { queryByTestId } = render(<BlogPublicationChecklist tripId="trip-1" backendUrl="http://api" headers={{}} styles={{}} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(queryByTestId('blog-publication-checklist')).toBeNull();
  });
});
