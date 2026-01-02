export interface User {
  id: string;
  email: string;
  provider: 'google' | 'apple' | 'email';
}

export interface WebUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface Flight {
  id: string;
  userId: string;
  passengerName: string;
  passengerIds?: string[];
  departureDate: string;
  tripId: string;
  departureLocation?: string;
  departureAirportCode?: string;
  departureTime: string;
  arrivalLocation?: string;
  arrivalAirportCode?: string;
  layoverLocation?: string;
  layoverLocationCode?: string;
  layoverDuration?: string;
  arrivalTime: string;
  cost: number;
  carrier: string;
  flightNumber: string;
  bookingReference: string;
  paidBy: string[];
  sharedWith?: string[];
  groupId?: string;
  passengerInGroup?: boolean;
  departureAirportLabel?: string;
  arrivalAirportLabel?: string;
  layoverAirportLabel?: string;
}

export interface Airport {
  iata_code: string;
  name: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export interface Group {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId?: string;
  guestName?: string;
  addedBy: string;
  createdAt: string;
  userEmail?: string;
}

export interface Trip {
  id: string;
  groupId: string;
  name: string;
  createdAt: string;
}

export interface Trait {
  id: string;
  userId: string;
  name: string;
  level: number;
  notes?: string | null;
  createdAt: string;
}

export interface Lodging {
  id: string;
  userId: string;
  tripId: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: number;
  refundBy?: string | null;
  totalCost: number;
  costPerNight: number;
  address: string;
  paidBy: string[];
  createdAt: string;
}

export interface Tour {
  id: string;
  userId: string;
  tripId: string;
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: number;
  freeCancelBy?: string | null;
  bookedOn: string;
  reference: string;
  paidBy: string[];
  createdAt: string;
}

export interface Itinerary {
  id: string;
  tripId: string;
  destination: string;
  days: number;
  budget?: number | null;
  createdAt: string;
}

export interface ItineraryDetail {
  id: string;
  itineraryId: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
}

export interface GroupInvite {
  id: string;
  groupId: string;
  inviterId: string;
  inviteeUserId: string;
  inviteeEmail: string;
  status: 'pending' | 'accepted';
  createdAt: string;
  groupName: string;
  inviterEmail: string;
}

export interface FamilyRelationship {
  id: string;
  requesterId: string;
  relativeId: string;
  relationship: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}
