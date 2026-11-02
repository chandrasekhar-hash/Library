// Centralized data definitions & helpers for Aks (अक्स) reading sanctuary

// Starts as a genuine empty library for a real first-time reading experience
export const initialLibraryBooks = [];

// Helper to calculate progress percentage consistently
export const calculateProgress = (currentPage, totalPages) => {
  if (!totalPages || totalPages <= 0) return 0;
  if (!currentPage || currentPage <= 0) return 0;
  return Math.min(100, Math.round((currentPage / totalPages) * 100));
};

// Available categories for filtering and book categorisation
export const LIBRARY_CATEGORIES = [
  'All',
  'Computer Science',
  'Mathematics',
  'Systems',
  'Networking',
  'Literature',
  'General',
];

// Available statuses for filtering
export const READING_STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'not-started', label: 'Not Started' },
  { id: 'completed', label: 'Completed' },
];

// Available sort options
export const SORT_OPTIONS = [
  { id: 'recently-read', label: 'Recently Read' },
  { id: 'title-asc', label: 'Title A–Z' },
  { id: 'title-desc', label: 'Title Z–A' },
  { id: 'progress-desc', label: 'Most Progress' },
  { id: 'progress-asc', label: 'Least Progress' },
];

// Aliases for components that consume current and recently opened books
export const currentBook = null;
export const recentlyOpenedBooks = [];
