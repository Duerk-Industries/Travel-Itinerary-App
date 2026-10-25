import { createContext } from 'react';
import type { CalendarApp } from '../utils/calendarEvents';

export const CalendarPreferenceContext = createContext<CalendarApp>('google');
