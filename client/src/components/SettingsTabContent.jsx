import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

const SettingsTabContent = function SettingsTabContent({ user, setUser }) {
  // Utility to normalize hex color to 6 digits
  function normalizeHex(hex) {
    if (!hex) return '#222222';
    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
      // Expand shorthand hex to 6 digits
      return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      return hex.toLowerCase();
    }
    // Fallback to black if invalid
    return '#222222';
  }
  const { theme, backgroundColor, textColor, font, timezone, setBackgroundColor, setTextColor, setFont, setTimezone } = useContext(ThemeContext);
  const [saving, setSaving] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  // Local state for pending color pickers
  const [pendingBackgroundColor, setPendingBackgroundColor] = useState(normalizeHex(backgroundColor));
  const [pendingTextColor, setPendingTextColor] = useState(normalizeHex(textColor));
  // ...existing code...

  // Only set default colors when theme changes AND colors are still at their defaults
  React.useEffect(() => {
    // Only update if colors are at their defaults (not user-picked)
    const defaultLightBg = '#fff';
    const defaultLightText = '#222222';
    const defaultDarkBg = '#222222';
    const defaultDarkText = '#ffffff';
    if (theme === 'dark') {
      if ((backgroundColor === defaultLightBg || backgroundColor === '#ffffff') && backgroundColor !== defaultDarkBg) {
        setBackgroundColor(defaultDarkBg);
      }
      if ((textColor === defaultLightText || textColor === '#222' || textColor === '#222222') && textColor !== defaultDarkText) {
        setTextColor(defaultDarkText);
      }
    } else {
      if ((backgroundColor === defaultDarkBg || backgroundColor === '#222') && backgroundColor !== defaultLightBg) {
        setBackgroundColor(defaultLightBg);
      }
      if ((textColor === defaultDarkText || textColor === '#fff' || textColor === '#ffffff') && textColor !== defaultLightText) {
        setTextColor(defaultLightText);
      }
    }
  }, [theme, backgroundColor, textColor, setBackgroundColor, setTextColor]);
  // Sync local pending color state with context when context changes (e.g. theme switch)
  React.useEffect(() => {
    setPendingBackgroundColor(normalizeHex(backgroundColor));
  }, [backgroundColor]);
  React.useEffect(() => {
    setPendingTextColor(normalizeHex(textColor));
  }, [textColor]);

  // Update current time every second
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format time in selected timezone
  function getTimeInTimezone(date, tz) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  }
  // Color change handler
  // Use local state for instant feedback, update context/backend only onBlur
  const handleBackgroundColorChange = (e) => {
    const newColor = e.target.value;
    setPendingBackgroundColor(newColor);
  };
  const handleBackgroundColorBlur = async (e) => {
    const newColor = normalizeHex(e.target.value);
    setBackgroundColor(newColor);
    if (!user?.username) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/update-colors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, backgroundColor: newColor, textColor })
      });
      const data = await res.json();
      if (data.success) {
        setUser(u => u ? { ...u, backgroundColor: data.backgroundColor, textColor: data.textColor } : u);
      }
    } catch (err) {
      console.log('Error updating colors:', err);
    }
    setSaving(false);
  };
  const handleTextColorChange = (e) => {
    const newColor = e.target.value;
    setPendingTextColor(newColor);
  };
  const handleTextColorBlur = async (e) => {
    const newColor = normalizeHex(e.target.value);
    setTextColor(newColor);
    if (!user?.username) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/update-colors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, backgroundColor, textColor: newColor })
      });
      const data = await res.json();
      if (data.success) {
        setUser(u => u ? { ...u, backgroundColor: data.backgroundColor, textColor: data.textColor } : u);
      }
    } catch (err) {
      console.log('Error updating colors:', err);
    }
    setSaving(false);
  };
  // Font change handler
  const handleFontChange = (e) => {
    const newFont = e.target.value;
    setFont(newFont);
    saveProfile({ font: newFont });
  };
  // Timezone change handler
  const handleTimezoneChange = (e) => {
    const newTz = e.target.value;
    setTimezone(newTz);
    saveProfile({ timezone: newTz });
  };
  // Save font/timezone changes to backend
  const saveProfile = (changes) => {
    if (!user?.username) return;
    setSaving(true);
    fetch(`${API_BASE_URL}/api/update-profile-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, font: changes.font || font, timezone: changes.timezone || timezone })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setUser(u => u ? { ...u, font: changes.font || font, timezone: changes.timezone || timezone } : u);
        }
      })
      .finally(() => setSaving(false));
  };
  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
      <h3>Profile Settings</h3>
      {/* Color Picker */}
      <div style={{ marginBottom: 24 }}>
        <h4>Theme Colors</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            Background:
      <input
        type="color"
        value={pendingBackgroundColor}
        onChange={handleBackgroundColorChange}
        onBlur={handleBackgroundColorBlur}
      />
            <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{pendingBackgroundColor}</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Text:
      <input
        type="color"
        value={pendingTextColor}
        onChange={handleTextColorChange}
        onBlur={handleTextColorBlur}
        style={{ border: '1px solid #ccc', borderRadius: 4 }}
      />
            <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{pendingTextColor}</span>
            </label>
      </div>
      {/* Font Picker */}
      <div style={{ marginBottom: 24 }}>
        <h4>Font</h4>
        <select value={font || ''} onChange={handleFontChange} style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', minWidth: 120 }}>
          <option value="">Default</option>
          <option value="serif">Serif</option>
          <option value="sans-serif">Sans-serif</option>
          <option value="monospace">Monospace</option>
          <option value="opendyslexic, sans-serif">OpenDyslexic</option>
        </select>
      </div>
      {/* Timezone Picker */}
      <div style={{ marginBottom: 24 }}>
        <h4>Timezone</h4>
        <select value={timezone || ''} onChange={handleTimezoneChange} style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', minWidth: 120 }}>
          {Intl.supportedValuesOf('timeZone').map(tz => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
        <div style={{ marginTop: 10, color: '#555', fontSize: 15 }}>
          Current time: <span style={{ fontFamily: 'monospace' }}>{getTimeInTimezone(currentTime, timezone || 'UTC')}</span>
        </div>
      </div>
      <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>
        {saving ? 'Saving changes...' : 'Changes are saved when you select a new value.'}
      </div>
    </div>
  );
};

export default SettingsTabContent;
