import express from 'express';
import morgan from 'morgan';
import { configureSecurityHeaders, configureCors } from './middleware/security.js';
import { sessionMiddleware } from './middleware/session.js';
import { csrfTokenGenerator } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import bookRoutes from './routes/bookRoutes.js';
import bookmarkRoutes from './routes/bookmarkRoutes.js';
import highlightRoutes from './routes/highlightRoutes.js';
import noteRoutes from './routes/noteRoutes.js';
import preferenceRoutes from './routes/preferenceRoutes.js';
import assetRoutes from './routes/assetRoutes.js';
import statisticsRoutes from './routes/statisticsRoutes.js';
import ocrRoutes from './routes/ocrRoutes.js';
import libraryIndexingRoutes from './routes/libraryIndexingRoutes.js';
import accountRelationshipRoutes from './routes/accountRelationshipRoutes.js';
import ownerAccessRoutes from './routes/ownerAccessRoutes.js';
import { env } from './config/env.js';

const app = express();
 
if (env.TRUST_PROXY !== false && env.TRUST_PROXY !== undefined) {
  app.set('trust proxy', env.TRUST_PROXY);
}

// Security and CORS
app.use(configureSecurityHeaders());
app.use(configureCors());

// HTTP Request logging
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.IS_PRODUCTION ? 'combined' : 'dev'));
}

// Request body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session-independent health check route (avoids anonymous database session creation)
app.use('/api', healthRoutes);

// Session and CSRF management
app.use(sessionMiddleware);
app.use(csrfTokenGenerator);

// Authenticated and stateful API Routes
app.use('/api/auth', authRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/highlights', highlightRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/preferences', preferenceRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/library/indexing', libraryIndexingRoutes);
app.use('/api/account/relationships', accountRelationshipRoutes);
app.use('/api/account/owner-access', ownerAccessRoutes);


// Fallthrough 404 handler
app.use(notFoundHandler);

// Centralized error handling
app.use(errorHandler);

export default app;
