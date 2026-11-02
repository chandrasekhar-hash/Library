import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  createNote,
  listNotes,
  getNote,
  updateNote,
  deleteNote,
} from '../controllers/noteController.js';
import {
  listSections,
  createSection,
  updateSection,
  deleteSection,
  reorderSections,
} from '../controllers/noteSectionController.js';

const router = Router();

// All notes endpoints require authentication
router.use(requireAuth);

// ── Personal Note Sections & Notebooks ──────────────────────────────────────
router.get('/sections', listSections);
router.post('/sections', validateCsrf, createSection);
router.patch('/sections/:sectionId', validateCsrf, updateSection);
router.delete('/sections/:sectionId', validateCsrf, deleteSection);
router.post('/sections/reorder', validateCsrf, reorderSections);

// ── Notes CRUD ──────────────────────────────────────────────────────────────
router.post('/', validateCsrf, createNote);
router.get('/', listNotes);
router.get('/:noteId', getNote);
router.patch('/:noteId', validateCsrf, updateNote);
router.delete('/:noteId', validateCsrf, deleteNote);

export default router;
