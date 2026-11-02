import React, { useState, useEffect } from 'react';
import { Feather, Moon, Sparkles } from 'lucide-react';
import StudyTimeCard from './StudyTimeCard';

export default function WelcomeSection() {
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Format date: e.g. "Thursday, October 22, 2026"
  const formattedDate = currentTime.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Format time: e.g. "04:35:12 PM"
  const formattedTime = currentTime.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <section className="welcome-banner-section" aria-label="Welcome banner">
      {/* Cinematic atmospheric glow */}
      <div className="welcome-bg-glow" />

      <div className="welcome-content-grid">
        {/* Left greeting & quote block */}
        <div className="welcome-main-col">
          <div className="welcome-badge">
            <Feather size={14} className="welcome-badge-icon" />
            <span>Evening Reading Sanctuary</span>
          </div>

          <h2 className="welcome-heading">Welcome Back</h2>
          <p className="welcome-subtitle">A new chapter always begins with you ♡</p>

          <div className="welcome-quote-card">
            <div className="quote-accent-bar" />
            <p className="welcome-quote-text">
              “Read a little, live a little, dream a little more.”
            </p>
          </div>
        </div>

        {/* Right atmospheric hero cards: Quiet Hours + Total Study Time */}
        <div className="welcome-hero-cards">
          {/* 1. Quiet Hours card */}
          <div className="welcome-time-card" aria-label="Current sanctuary time and quiet hours">
            <div className="time-card-header">
              <div className="time-card-icon-halo">
                <Moon size={18} className="moon-icon" />
              </div>
              <span className="time-card-status">Quiet Hours</span>
            </div>

            <div className="time-card-body">
              <div className="time-display">{formattedTime}</div>
              <div className="date-display">{formattedDate}</div>
            </div>

            <div className="time-card-footer">
              <Sparkles size={13} className="sparkle-icon" />
              <span className="calm-mind-text">A calm mind reads deeper.</span>
            </div>
          </div>

          {/* 2. Total Study Time card */}
          <StudyTimeCard />
        </div>
      </div>
    </section>
  );
}
