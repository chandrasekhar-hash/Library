import React, { useState } from 'react';
import { Eye, LogOut, ShieldAlert, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function OwnerAccessBanner({ onExited }) {
  const { ownerAccessContext, exitOwnerAccess } = useAuth();
  const [isExiting, setIsExiting] = useState(false);

  if (!ownerAccessContext || !ownerAccessContext.targetUser) {
    return null;
  }

  const targetUser = ownerAccessContext.targetUser;

  const handleExit = async () => {
    try {
      setIsExiting(true);
      await exitOwnerAccess();
      if (typeof onExited === 'function') {
        onExited();
      }
    } catch (err) {
      console.error('[OwnerAccessBanner] Failed to exit owner access:', err);
    } finally {
      setIsExiting(false);
    }
  };

  return (
    <div
      className="owner-access-persistent-banner"
      role="region"
      aria-label="Owner Access Notification"
      style={{
        background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.22) 100%)',
        borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        zIndex: 40,
        position: 'sticky',
        top: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: 'rgba(245, 158, 11, 0.25)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fbbf24',
            flexShrink: 0,
          }}
        >
          <Eye size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                backgroundColor: 'rgba(245, 158, 11, 0.25)',
                color: '#fef3c7',
                padding: '2px 8px',
                borderRadius: '4px',
                border: '1px solid rgba(245, 158, 11, 0.4)',
              }}
            >
              Owner Access &bull; Read-Only
            </span>
            <span style={{ fontSize: '0.875rem', color: '#fef3c7', fontWeight: 500 }}>
              Viewing account of <strong style={{ color: '#fff' }}>{targetUser.name || 'User'}</strong>
              <span style={{ opacity: 0.8, marginLeft: '6px' }}>({targetUser.email})</span>
            </span>
          </div>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'rgba(254, 243, 199, 0.75)' }}>
            All operations are read-only. Data modifications, uploads, and deletions are disabled.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleExit}
        disabled={isExiting}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 14px',
          fontSize: '0.8125rem',
          fontWeight: 600,
          color: '#1c1917',
          backgroundColor: '#f59e0b',
          border: '1px solid #d97706',
          borderRadius: '6px',
          cursor: isExiting ? 'not-allowed' : 'pointer',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
          transition: 'all 0.15s ease',
          opacity: isExiting ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isExiting) e.currentTarget.style.backgroundColor = '#fbbf24';
        }}
        onMouseLeave={(e) => {
          if (!isExiting) e.currentTarget.style.backgroundColor = '#f59e0b';
        }}
      >
        {isExiting ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
        <span>Exit Owner Access</span>
      </button>
    </div>
  );
}

