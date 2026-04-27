// ApRez Shared Constants

// Table statuses and their display properties
const TABLE_STATUS = {
  FREE: { key: 'FREE', color: '#4CAF50', labelRo: 'Liber', labelEn: 'Free' },
  OCCUPIED: { key: 'OCCUPIED', color: '#F44336', labelRo: 'Ocupat', labelEn: 'Occupied' },
  ARRIVING_SOON: { key: 'ARRIVING_SOON', color: '#FF9800', labelRo: 'Vine curând', labelEn: 'Arriving Soon' },
  AWAITING_GUEST: { key: 'AWAITING_GUEST', color: '#E57373', labelRo: 'Așteaptă clientul', labelEn: 'Awaiting Guest' },
  OUT_OF_SERVICE: { key: 'OUT_OF_SERVICE', color: '#9E9E9E', labelRo: 'Indisponibil', labelEn: 'Out of Service' },
};

// Reservation statuses
const RESERVATION_STATUS = {
  PENDING: { key: 'PENDING', labelRo: 'În așteptare', labelEn: 'Pending' },
  CONFIRMED: { key: 'CONFIRMED', labelRo: 'Confirmat', labelEn: 'Confirmed' },
  AUTO_CONFIRMED: { key: 'AUTO_CONFIRMED', labelRo: 'Confirmat automat', labelEn: 'Auto-Confirmed' },
  MODIFICATION_PENDING: { key: 'MODIFICATION_PENDING', labelRo: 'Modificare în așteptare', labelEn: 'Modification Pending' },
  CANCELLED: { key: 'CANCELLED', labelRo: 'Anulat', labelEn: 'Cancelled' },
  COMPLETED: { key: 'COMPLETED', labelRo: 'Finalizat', labelEn: 'Completed' },
  NO_SHOW: { key: 'NO_SHOW', labelRo: 'Nu s-a prezentat', labelEn: 'No Show' },
};

// Waitlist statuses
const WAITLIST_STATUS = {
  WAITING: { key: 'WAITING', labelRo: 'În așteptare', labelEn: 'Waiting' },
  NOTIFIED: { key: 'NOTIFIED', labelRo: 'Notificat', labelEn: 'Notified' },
  CONFIRMED: { key: 'CONFIRMED', labelRo: 'Confirmat', labelEn: 'Confirmed' },
  EXPIRED: { key: 'EXPIRED', labelRo: 'Expirat', labelEn: 'Expired' },
  CANCELLED: { key: 'CANCELLED', labelRo: 'Anulat', labelEn: 'Cancelled' },
};

// Cuisine types available for restaurants
const CUISINE_TYPES = [
  { value: 'Romanian', labelRo: 'Românească', labelEn: 'Romanian' },
  { value: 'Traditional', labelRo: 'Tradițională', labelEn: 'Traditional' },
  { value: 'Italian', labelRo: 'Italiană', labelEn: 'Italian' },
  { value: 'French', labelRo: 'Franceză', labelEn: 'French' },
  { value: 'Asian', labelRo: 'Asiatică', labelEn: 'Asian' },
  { value: 'Japanese', labelRo: 'Japoneză', labelEn: 'Japanese' },
  { value: 'Chinese', labelRo: 'Chinezească', labelEn: 'Chinese' },
  { value: 'Indian', labelRo: 'Indiană', labelEn: 'Indian' },
  { value: 'Mediterranean', labelRo: 'Mediteraneană', labelEn: 'Mediterranean' },
  { value: 'Mexican', labelRo: 'Mexicană', labelEn: 'Mexican' },
  { value: 'American', labelRo: 'Americană', labelEn: 'American' },
  { value: 'Greek', labelRo: 'Grecească', labelEn: 'Greek' },
  { value: 'Turkish', labelRo: 'Turcească', labelEn: 'Turkish' },
  { value: 'Seafood', labelRo: 'Fructe de mare', labelEn: 'Seafood' },
  { value: 'Steakhouse', labelRo: 'Steakhouse', labelEn: 'Steakhouse' },
  { value: 'Vegetarian', labelRo: 'Vegetariană', labelEn: 'Vegetarian' },
  { value: 'Vegan', labelRo: 'Vegană', labelEn: 'Vegan' },
  { value: 'Pizza', labelRo: 'Pizza', labelEn: 'Pizza' },
  { value: 'FastFood', labelRo: 'Fast Food', labelEn: 'Fast Food' },
  { value: 'Cafe', labelRo: 'Cafenea', labelEn: 'Cafe' },
  { value: 'Bar', labelRo: 'Bar', labelEn: 'Bar' },
  { value: 'Fine Dining', labelRo: 'Fine Dining', labelEn: 'Fine Dining' },
];

// Time-related constants
const RESERVATION_DURATION_MIN = 120; // Fixed for MVP
const TIME_SLOT_INTERVAL_MIN = 15; // 15-minute intervals
const SAME_DAY_MIN_LEAD_MIN = 30; // Minimum 30 minutes for same-day booking
const AUTO_CONFIRM_MAX_PARTY = 4;
const AUTO_CONFIRM_LEAD_HOURS = 24;
const OCCUPIED_TIMER_MIN = 120; // Table timer duration
const AWAITING_GUEST_REMINDER_MIN = 15; // Light Red reminder interval
const WAITLIST_CONFIRM_WINDOW_MIN = 10; // 10 minutes to confirm
const WAITLIST_SECOND_REMINDER_MIN = 5; // 5-minute reminder
const PRE_RESERVATION_REMINDER_MIN = 45; // 45-minute reminder
const WALK_IN_DEFAULT_GUEST_COUNT = 2;
const MAX_PARTY_SIZE = 30;
const MAX_TABLES_MERGE = 4;
const HISTORY_DAYS = 30;

// Billing
const FEE_PER_PERSON_RON = 1;

module.exports = {
  TABLE_STATUS,
  RESERVATION_STATUS,
  WAITLIST_STATUS,
  CUISINE_TYPES,
  RESERVATION_DURATION_MIN,
  TIME_SLOT_INTERVAL_MIN,
  SAME_DAY_MIN_LEAD_MIN,
  AUTO_CONFIRM_MAX_PARTY,
  AUTO_CONFIRM_LEAD_HOURS,
  OCCUPIED_TIMER_MIN,
  AWAITING_GUEST_REMINDER_MIN,
  WAITLIST_CONFIRM_WINDOW_MIN,
  WAITLIST_SECOND_REMINDER_MIN,
  PRE_RESERVATION_REMINDER_MIN,
  WALK_IN_DEFAULT_GUEST_COUNT,
  MAX_PARTY_SIZE,
  MAX_TABLES_MERGE,
  HISTORY_DAYS,
  FEE_PER_PERSON_RON,
};
