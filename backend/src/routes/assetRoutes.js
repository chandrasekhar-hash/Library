import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import { uploadRateLimiter } from '../middleware/rateLimiter.js';
import {
  uploadBackgroundAsset,
  listAssets,
  getAssetMetadata,
  streamAssetFile,
  deleteAsset,
} from '../controllers/assetController.js';

const router = Router();

// All asset routes require authentication
router.use(requireAuth);

router.post('/backgrounds', uploadRateLimiter, validateCsrf, uploadBackgroundAsset);
router.get('/', listAssets);
router.get('/:assetId', getAssetMetadata);
router.get('/:assetId/file', streamAssetFile);
router.delete('/:assetId', validateCsrf, deleteAsset);

export default router;
