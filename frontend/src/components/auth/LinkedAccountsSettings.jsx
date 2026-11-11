import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Eye,
  LogOut,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  History,
  Shield,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { accountRelationshipsApi, ownerAccessApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export default function LinkedAccountsSettings({ onNavigateTo }) {
  const { currentUser, ownerAccessContext, startOwnerAccess, exitOwnerAccess } = useAuth();

  const [linkedUsers, setLinkedUsers] = useState([]);
  const [history, setHistory] = useState([]);
  const [totalHistory, setTotalHistory] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Link user form state
  const [newEmail, setNewEmail] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [isActingUserId, setIsActingUserId] = useState(null);

  const activeTargetId = ownerAccessContext?.targetUser?.id || null;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const [relRes, histRes] = await Promise.all([
        accountRelationshipsApi.listLinkedUsers(),
        ownerAccessApi.getAccessHistory({ limit: 10 }),
      ]);
      setLinkedUsers(relRes?.relationships || relRes || []);
      setHistory(histRes?.history || []);
      setTotalHistory(histRes?.total || 0);
    } catch (err) {
      console.error('[LinkedAccountsSettings] Failed to fetch data:', err);
      setActionError(err.message || 'Failed to load linked accounts.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleLinkUser = async (e) => {
    e.preventDefault();
    if (!newEmail || !newEmail.trim()) return;

    setIsLinking(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await accountRelationshipsApi.linkUser({ targetEmail: newEmail.trim() });
      setActionSuccess(
        res.isReactivated
          ? `Successfully reactivated relationship with ${newEmail.trim()}.`
          : `Successfully linked user ${newEmail.trim()}.`
      );
      setNewEmail('');
      await loadData();
    } catch (err) {
      setActionError(err.message || 'Failed to link user account.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleStartAccess = async (targetUserId, targetName) => {
    setIsActingUserId(targetUserId);
    setActionError(null);
    setActionSuccess(null);

    try {
      await startOwnerAccess(targetUserId);
      setActionSuccess(`Now viewing ${targetName || 'user'}'s account in read-only mode.`);
      if (typeof onNavigateTo === 'function') {
        onNavigateTo('home');
      }
    } catch (err) {
      setActionError(err.message || 'Failed to start owner access.');
    } finally {
      setIsActingUserId(null);
    }
  };

  const handleExitAccess = async () => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await exitOwnerAccess();
      setActionSuccess('Exited owner access. Returned to your own account view.');
      await loadData();
    } catch (err) {
      setActionError(err.message || 'Failed to exit owner access.');
    }
  };

  const handleRevokeRelationship = async (targetUserId, targetEmail) => {
    if (!window.confirm(`Revoke owner relationship for ${targetEmail}? The account will be unlinked and any active owner access invalidated.`)) {
      return;
    }

    setIsActingUserId(targetUserId);
    setActionError(null);
    setActionSuccess(null);

    try {
      await accountRelationshipsApi.revokeRelationship(targetUserId);
      setActionSuccess(`Relationship with ${targetEmail} was successfully revoked.`);
      await loadData();
    } catch (err) {
      setActionError(err.message || 'Failed to revoke relationship.');
    } finally {
      setIsActingUserId(null);
    }
  };

  if (currentUser?.role !== 'OWNER') {
    return (
      <div className="settings-section">
        <div className="settings-notice alert-warning">
          <Shield size={18} />
          <span>Linked accounts and owner-authorized access are restricted to accounts with the OWNER role.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section linked-accounts-settings">
      <div className="settings-section-header">
        <div className="settings-title-group">
          <h2 className="settings-section-title">
            <Users size={20} className="text-accent" />
            <span>Linked Accounts & Owner Access</span>
          </h2>
          <p className="settings-section-subtitle">
            Securely link user accounts to inspect reading libraries, notes, and study progress in separate, read-only sessions without credentials or modification permissions.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
          className="settings-btn-secondary"
          title="Refresh linked accounts"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {actionError && (
        <div className="settings-notice alert-error" style={{ marginBottom: '16px' }}>
          <AlertCircle size={18} />
          <span>{actionError}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="settings-notice alert-success" style={{ marginBottom: '16px' }}>
          <CheckCircle2 size={18} />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* 1. Link New Account Card */}
      <div className="settings-card" style={{ marginBottom: '24px' }}>
        <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UserPlus size={18} className="text-accent" />
          <span>Link a Registered User</span>
        </h3>
        <p className="settings-card-desc">
          Enter the email of an existing registered user to establish an authorized relationship.
        </p>

        <form onSubmit={handleLinkUser} style={{ display: 'flex', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="user@example.com"
            disabled={isLinking}
            required
            className="settings-text-input"
            style={{
              flex: '1 1 260px',
              padding: '8px 14px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#fff',
            }}
          />
          <button
            type="submit"
            disabled={isLinking || !newEmail.trim()}
            className="settings-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {isLinking ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
            <span>Link Account</span>
          </button>
        </form>
      </div>

      {/* 2. Active Linked Accounts List */}
      <div className="settings-card" style={{ marginBottom: '24px' }}>
        <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Users size={18} className="text-accent" />
          <span>Linked Accounts ({linkedUsers.length})</span>
        </h3>

        {isLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
            <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
            <span>Loading linked accounts...</span>
          </div>
        ) : linkedUsers.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
            <p>No user accounts have been linked yet.</p>
            <p style={{ fontSize: '0.8125rem' }}>Use the form above to link a registered user.</p>
          </div>
        ) : (
          <div className="linked-users-table" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {linkedUsers.map((item) => {
              const u = item.user || {};
              const isViewing = activeTargetId === item.userId;
              const isActing = isActingUserId === item.userId;
              const isActive = item.status === 'ACTIVE';

              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: isViewing ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                    border: isViewing ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        backgroundColor: isViewing ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: isViewing ? '#fbbf24' : '#fff',
                        flexShrink: 0,
                      }}
                    >
                      {(u.name || u.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ color: '#fff', fontSize: '0.9375rem' }}>{u.name || 'User'}</strong>
                        <span
                          style={{
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: isActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: isActive ? '#4ade80' : '#f87171',
                            border: `1px solid ${isActive ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                          }}
                        >
                          {item.status}
                        </span>
                        {isViewing && (
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(245, 158, 11, 0.25)',
                              color: '#fbbf24',
                              border: '1px solid rgba(245, 158, 11, 0.5)',
                            }}
                          >
                            Currently Viewing
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.8125rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '2px' }}>
                        {u.email}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isViewing ? (
                      <button
                        type="button"
                        onClick={handleExitAccess}
                        className="settings-btn-secondary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#fbbf24' }}
                      >
                        <LogOut size={14} />
                        <span>Exit View</span>
                      </button>
                    ) : isActive ? (
                      <button
                        type="button"
                        onClick={() => handleStartAccess(item.userId, u.name)}
                        disabled={isActing}
                        className="settings-btn-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        {isActing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                        <span>View Account</span>
                      </button>
                    ) : null}

                    {isActive && (
                      <button
                        type="button"
                        onClick={() => handleRevokeRelationship(item.userId, u.email)}
                        disabled={isActing}
                        className="settings-btn-danger"
                        title="Revoke relationship"
                        style={{ padding: '6px 10px' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Owner Access Audit History */}
      <div className="settings-card">
        <h3 className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <History size={18} className="text-accent" />
          <span>Owner Access Audit History ({totalHistory})</span>
        </h3>
        <p className="settings-card-desc">
          Complete, server-recorded audit trail of owner-authorized account access sessions.
        </p>

        {history.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
            No owner access sessions recorded yet.
          </div>
        ) : (
          <div style={{ marginTop: '12px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', textAlign: 'left', color: 'rgba(255, 255, 255, 0.6)' }}>
                  <th style={{ padding: '8px 12px' }}>Target Account</th>
                  <th style={{ padding: '8px 12px' }}>Status</th>
                  <th style={{ padding: '8px 12px' }}>Started At</th>
                  <th style={{ padding: '8px 12px' }}>Ended At</th>
                  <th style={{ padding: '8px 12px' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '8px 12px', color: '#fff' }}>
                      {h.targetUser?.name || 'User'} ({h.targetUser?.email || 'N/A'})
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          backgroundColor:
                            h.status === 'ACTIVE'
                              ? 'rgba(34, 197, 94, 0.15)'
                              : h.status === 'EXITED'
                              ? 'rgba(59, 130, 246, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                          color:
                            h.status === 'ACTIVE'
                              ? '#4ade80'
                              : h.status === 'EXITED'
                              ? '#60a5fa'
                              : '#f87171',
                        }}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'rgba(255, 255, 255, 0.7)' }}>
                      {h.startedAt ? new Date(h.startedAt).toLocaleString() : 'N/A'}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'rgba(255, 255, 255, 0.7)' }}>
                      {h.endedAt ? new Date(h.endedAt).toLocaleString() : 'Active / In progress'}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'rgba(255, 255, 255, 0.5)' }}>
                      {h.revocationReason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

