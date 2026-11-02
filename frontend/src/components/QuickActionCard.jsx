import React from 'react';
import { ArrowUpRight } from 'lucide-react';

export default function QuickActionCard({
  title,
  description,
  icon: Icon,
  accentColor = '#E7C18A',
  onClick,
  statusBadge = null,
  active = false,
}) {
  return (
    <div
      className={`quick-action-card ${active ? 'active' : ''}`}
      style={{ '--action-accent': accentColor }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="action-top-row">
        <div className="action-icon-halo">
          <Icon size={20} className="action-icon" />
        </div>
        <div className="action-arrow-indicator">
          <ArrowUpRight size={16} />
        </div>
      </div>

      <div className="action-text-content">
        <h4 className="action-title">{title}</h4>
        <p className="action-desc">{description}</p>
      </div>

      {statusBadge && (
        <div className="action-status-badge">
          <span className="status-dot" />
          <span className="status-text">{statusBadge}</span>
        </div>
      )}
    </div>
  );
}
