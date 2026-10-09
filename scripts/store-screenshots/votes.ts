/**
 * App Store screenshot for voting on plans: three stays in Lisbon, real votes from all four
 * travelers. The group's favorite gets booked; one option still waits on Maya's vote.
 * Runs on its own trip (same four accounts, so avatar colors match the other screenshots) so
 * these proposed prices don't touch the expense screenshots. Called from itinerary-blog.spec.ts.
 */
import { expect, type Page } from '@playwright/test';
import path from 'path';
import { API_BASE } from '../../app/e2e/fixtures';
import { createDemoTrip, goToTile, iso, shoot, type DemoUsers, type Traveler } from './demoTrip';

const OUT = path.join(__dirname, 'output');

const OPTIONS: Array<{ name: string; cost: number; votes: Partial<Record<Traveler, 1 | -1>>; book?: boolean }> = [
  { name: 'Alfama apartment with river view', cost: 1180, votes: { Maya: 1, Jordan: 1, Priya: 1, Sam: 1 }, book: true },
  { name: 'Graça loft with rooftop terrace', cost: 1340, votes: { Jordan: 1, Priya: 1, Sam: -1 } },
  { name: 'Baixa boutique hotel', cost: 1520, votes: { Priya: 1, Maya: -1, Jordan: -1, Sam: -1 } },
  { name: 'Chiado studio by Tram 28', cost: 990, votes: { Sam: 1, Maya: 1, Priya: -1 } },
  { name: 'Belém guesthouse', cost: 1060, votes: { Jordan: 1, Priya: -1, Sam: -1, Maya: -1 } },
];

export async function captureVotes(page: Page, users: DemoUsers) {
  const { auth, authOf, trip, idOf } = await createDemoTrip(page, 'Lisbon Long Weekend', users);
  const everyone = (['Maya', 'Jordan', 'Priya', 'Sam'] as Traveler[]).map(idOf);

  for (const option of OPTIONS) {
    const created = await page.request.post(`${API_BASE}/api/lodgings`, {
      headers: auth,
      data: { tripId: trip.id, status: 'Proposed', name: option.name, checkInDate: iso(0), checkOutDate: iso(4), rooms: 2, totalCost: option.cost, travelerIds: everyone },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const lodging = await created.json();
    for (const [who, value] of Object.entries(option.votes) as Array<[Traveler, 1 | -1]>) {
      const vote = await page.request.post(`${API_BASE}/api/lodgings/${lodging.id}/vote`, { headers: authOf(who), data: { value } });
      expect(vote.ok(), await vote.text()).toBeTruthy();
    }
    if (option.book) {
      const booked = await page.request.put(`${API_BASE}/api/lodgings/${lodging.id}`, { headers: auth, data: { status: 'Booked', paidBy: [idOf('Maya')] } });
      expect(booked.ok(), await booked.text()).toBeTruthy();
    }
  }

  await goToTile(page, 'lodging');
  await expect(page.getByTestId('lodging-cards')).toBeVisible({ timeout: 30_000 });
  await shoot(page, path.join(OUT, 'votes-full.png'));
}
