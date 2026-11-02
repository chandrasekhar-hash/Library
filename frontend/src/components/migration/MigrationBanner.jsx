/**
 * MigrationBanner.jsx
 * Aks (अक्स) — Phase 7: Non-intrusive Migration Notification Banner
 */

import React, { useState, useEffect } from 'react';
import { Feather, ArrowRight, X } from 'lucide-react';
import { inspectGuestData } from '../../services/migrationService';

export default function MigrationBanner({ currentUser, onOpenMigration }) {
  const [shouldShow, setShouldShow] = useState(false);
  const [guestCount, setGuestCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function checkGuestData() {
      if (!currentUser) {
        if (isMounted) setShouldShow(false);
        return;
      }

      const dismissed = sessionStorage.getItem('aks_dismiss_migration_banner');
      if (dismissed === 'true') {
        if (isMounted) setShouldShow(false);
        return;
      }

      try {
        const preview = await inspectGuestData(currentUser);
        if (isMounted) {
          if (preview.hasGuestData && preview.totalBooks > 0) {
            setGuestCount(preview.totalBooks);
            setShouldShow(true);
          } else {
            setShouldShow(false);
          }
        }
      } catch (err) {
        console.warn('[MigrationBanner] Preview check failed:', err);
      }
    }

    checkGuestData();

    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  if (!shouldShow) return null;

  const handleDismiss = () => {
    sessionStorage.setItem('aks_dismiss_migration_banner', 'true');
    setShouldShow(false);
  };

  return (
    <div className="migration-banner" role="region" aria-label="Guest data migration notice">
      <div className="migration-banner-left">
        <div className="migration-banner-icon">
          <Feather size={16} />
        </div>
        <div className="migration-banner-text">
          <strong>Local Reading Sanctuary Detected:</strong>
          <span>
            You have {guestCount} volume{guestCount === 1 ? '' : 's'} saved locally on this device.
          </span>
        </div>
      </div>

      <div className="migration-banner-actions">
        <button className="migration-btn-review" onClick={onOpenMigration}>
          Review Migration <ArrowRight size={13} />
        </button>
        <button
          className="migration-btn-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss banner for this session"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
