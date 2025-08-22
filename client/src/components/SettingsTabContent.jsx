import React, { useContext, useState, useImperativeHandle, forwardRef } from "react";
import { ThemeContext } from "../themeContext";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;


const SettingsTabContent = forwardRef(function SettingsTabContent(props, ref) {
  // Save pending profile changes to backend
  const savePendingProfile = async () => {
    if (!props.user?.username) return;
    try {
      await fetch(`${API_BASE_URL}/api/update-profile-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: props.user.username,
          backgroundColor: pendingProfile.backgroundColor,
          textColor: pendingProfile.textColor,
          font: pendingProfile.font,
          timezone: pendingProfile.timezone,
        })
      });
      // Optionally update user in parent/context
      if (props.setUser) {
        props.setUser(u => u ? { ...u, ...pendingProfile } : u);
      }
    } catch (err) {
      console.log('Error saving profile:', err);
    }
  };

  // Expose savePendingProfile to parent via ref
  useImperativeHandle(ref, () => ({
    savePendingProfile,
    getPendingProfile: () => pendingProfile,
  }));
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
  // Removed unused saving state
  const [currentTime, setCurrentTime] = useState(() => new Date());
  // Local state for all pending profile changes
  const [pendingProfile, setPendingProfile] = useState({
    backgroundColor: normalizeHex(backgroundColor),
    textColor: normalizeHex(textColor),
    font: font || '',
    timezone: timezone || 'UTC',
  });

  // Sync local pending state with context when context changes (e.g. theme switch)
  React.useEffect(() => {
    setPendingProfile(p => ({ ...p, backgroundColor: normalizeHex(backgroundColor) }));
  }, [backgroundColor]);
  React.useEffect(() => {
    setPendingProfile(p => ({ ...p, textColor: normalizeHex(textColor) }));
  }, [textColor]);
  React.useEffect(() => {
    setPendingProfile(p => ({ ...p, font: font || '' }));
  }, [font]);
  React.useEffect(() => {
    setPendingProfile(p => ({ ...p, timezone: timezone || 'UTC' }));
  }, [timezone]);

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
  // Removed obsolete setPendingBackgroundColor and setPendingTextColor

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
  // ...existing code...
  // Font change handler
  const handleFontChange = (e) => {
    const newFont = e.target.value;
    setPendingProfile(p => ({ ...p, font: newFont }));
    setFont(newFont); // Immediate UI feedback
  };
  // Timezone change handler
  const handleTimezoneChange = (e) => {
    const newTz = e.target.value;
    setPendingProfile(p => ({ ...p, timezone: newTz }));
    setTimezone(newTz); // Immediate UI feedback
  };
  // --- Local preview logic for color picker ---
  // Local preview state for color pickers
  const [previewBackgroundColor, setPreviewBackgroundColor] = useState(pendingProfile.backgroundColor);
  const [previewTextColor, setPreviewTextColor] = useState(pendingProfile.textColor);

  // Reset preview color ONLY when context color changes (e.g. theme switch)
  React.useEffect(() => {
    setPreviewBackgroundColor(normalizeHex(backgroundColor));
  }, [backgroundColor]);
  React.useEffect(() => {
    setPreviewTextColor(normalizeHex(textColor));
  }, [textColor]);

  // Color change handler: update local preview only
  const handleBackgroundColorChange = (e) => {
    const newColor = e.target.value;
    setPreviewBackgroundColor(newColor);
    setPendingProfile(p => ({ ...p, backgroundColor: newColor }));
  };
  // On blur: update global context
  const handleBackgroundColorBlur = () => {
    setBackgroundColor(previewBackgroundColor);
  };
  const handleTextColorChange = (e) => {
    const newColor = e.target.value;
    setPreviewTextColor(newColor);
    setPendingProfile(p => ({ ...p, textColor: newColor }));
  };
  const handleTextColorBlur = () => {
    setTextColor(previewTextColor);
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
        value={previewBackgroundColor}
        onChange={handleBackgroundColorChange}
        onInput={handleBackgroundColorChange}
        onBlur={handleBackgroundColorBlur}
      />
            <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{pendingProfile.backgroundColor}</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Text:
      <input
        type="color"
        value={previewTextColor}
        onChange={handleTextColorChange}
        onInput={handleTextColorChange}
        onBlur={handleTextColorBlur}
        style={{ border: '1px solid #ccc', borderRadius: 4 }}
      />
            <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{pendingProfile.textColor}</span>
            </label>
      </div>
      {/* Font Picker */}
      <div style={{ marginBottom: 24 }}>
        <h4>Font</h4>
        <select value={pendingProfile.font || ''} onChange={handleFontChange} style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', minWidth: 120 }}>
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
        <select value={pendingProfile.timezone || ''} onChange={handleTimezoneChange} style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', minWidth: 120 }}>
          {Intl.supportedValuesOf('timeZone').map(tz => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
        <div style={{ marginTop: 10, color: '#555', fontSize: 15 }}>
          Current time: <span style={{ fontFamily: 'monospace' }}>{getTimeInTimezone(currentTime, pendingProfile.timezone || 'UTC')}</span>
        </div>
      </div>
      <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>
        {'Changes are saved when you leave the settings tab or page.'}
      </div>
    </div>
  );
});

export default SettingsTabContent;
