import React, { useContext, useState, useImperativeHandle, forwardRef } from "react";
import { stepTextColor } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;


const SettingsTabContent = forwardRef(function SettingsTabContent(props, ref) {
  // Always get context first so values are available for state initializers
  const { theme, setTheme, backgroundColor, textColor, font, timezone, setBackgroundColor, setTextColor, setFont, setTimezone } = useContext(ThemeContext);

  // --- Restore preview state for color picker ---
  const [previewBackgroundColor, setPreviewBackgroundColor] = useState(backgroundColor);
  const [previewTextColor, setPreviewTextColor] = useState(textColor);

  // Sync preview state with context when context changes (e.g. theme switch)
  React.useEffect(() => {
    setPreviewBackgroundColor(backgroundColor);
  }, [backgroundColor]);
  React.useEffect(() => {
    setPreviewTextColor(textColor);
  }, [textColor]);

  // Save pending profile changes to backend
  const savePendingProfile = async () => {
    if (!props.user?.username) return;
    try {
      // Save font and timezone
      const profileRes = await fetch(`${API_BASE_URL}/api/update-profile-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: props.user.username,
          font: pendingProfile.font,
          timezone: pendingProfile.timezone,
        })
      });
      const profileData = await profileRes.json();

      // Save colors
      const colorRes = await fetch(`${API_BASE_URL}/api/update-colors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: props.user.username,
          backgroundColor: pendingProfile.backgroundColor,
          textColor: pendingProfile.textColor,
        })
      });
      const colorData = await colorRes.json();

      // Update user context with latest data
      if (props.setUser) {
        props.setUser(u => u ? { ...u, ...profileData, ...colorData } : u);
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
  // Removed unused saving state
  const [currentTime, setCurrentTime] = useState(() => new Date());
  // Local state for all pending profile changes
  const [pendingProfile, setPendingProfile] = useState(() => {
    // If user has no timezone set, use system timezone
    let initialTimezone = timezone;
    if (!props.user?.timezone) {
      initialTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
    return {
      backgroundColor: normalizeHex(backgroundColor),
      textColor: normalizeHex(textColor),
      font: font || '',
      timezone: initialTimezone || 'UTC',
    };
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
    // Only apply default colors if theme is not 'custom'
    const defaultLightBg = '#fff';
    const defaultLightText = '#222222';
    const defaultDarkBg = '#222222';
    const defaultDarkText = '#ffffff';
    if (theme === 'custom') {
      // Do not override custom colors
      return;
    }
    if (theme === 'dark') {
      if ((backgroundColor !== defaultDarkBg)) {
        setBackgroundColor(defaultDarkBg);
      }
      if ((textColor !== defaultDarkText)) {
        setTextColor(defaultDarkText);
      }
    } else {
      if ((backgroundColor !== defaultLightBg)) {
        setBackgroundColor(defaultLightBg);
      }
      if ((textColor !== defaultLightText)) {
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
      // Patch: update user object in context immediately
      if (props.setUser) {
        props.setUser(u => u ? { ...u, font: newFont } : u);
      }
    };
  // Timezone change handler
    const handleTimezoneChange = (e) => {
      const newTz = e.target.value;
      setPendingProfile(p => ({ ...p, timezone: newTz }));
      setTimezone(newTz); // Immediate UI feedback
      // Patch: update user object in context immediately
      if (props.setUser) {
        props.setUser(u => u ? { ...u, timezone: newTz } : u);
      }
    };
  // --- Color picker logic: always use and update context values immediately ---
  function activateCustomTheme() {
    const html = document.documentElement;
    html.classList.remove('light', 'dark');
    html.classList.add('custom');
  }
  // Color change handler: update context and CSS variables immediately
  // On change: update preview only
    const handleBackgroundColorChange = (e) => {
      const newColor = e.target.value;
      setPreviewBackgroundColor(newColor);
      setPendingProfile(p => ({ ...p, backgroundColor: newColor }));
      document.documentElement.style.setProperty('--background-color', newColor);
      activateCustomTheme();
      setTheme('custom');
      setBackgroundColor(newColor);
      // Patch: update user object in context immediately
      if (props.setUser) {
        props.setUser(u => u ? { ...u, background_color: newColor, backgroundColor: newColor } : u);
      }
    };
    const handleTextColorChange = (e) => {
      const newColor = e.target.value;
      setPreviewTextColor(newColor);
      setPendingProfile(p => ({ ...p, textColor: newColor }));
      document.documentElement.style.setProperty('--text-color', newColor);
      // Dynamically set secondary and link colors for contrast
      const html = document.documentElement;
      const themeClass = html.classList.contains('dark') ? 'dark' : (html.classList.contains('light') ? 'light' : 'custom');
      const secondaryText = stepTextColor(newColor, themeClass, 1);
      const linkColor = stepTextColor(newColor, themeClass, 2);
      document.documentElement.style.setProperty('--secondary-text-color', secondaryText);
      document.documentElement.style.setProperty('--link-color', linkColor);
      activateCustomTheme();
      setTheme('custom');
      setTextColor(newColor);
      // Patch: update user object in context immediately
      if (props.setUser) {
        props.setUser(u => u ? { ...u, text_color: newColor, textColor: newColor } : u);
      }
    };

  // On blur: commit preview color to context
  const handleBackgroundColorBlur = () => {
    setBackgroundColor(previewBackgroundColor);
    activateCustomTheme();
  };
  const handleTextColorBlur = () => {
    setTextColor(previewTextColor);
    activateCustomTheme();
  };
  return (
  <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 32, background: previewBackgroundColor, color: previewTextColor }}>
      <h3>Profile Settings</h3>
      {/* Color Picker */}
      <div style={{ marginBottom: 24 }}>
        <h4>Theme Colors</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            Background:
      <input
        type="color"
        value={normalizeHex(previewBackgroundColor)}
        onChange={handleBackgroundColorChange}
        onBlur={handleBackgroundColorBlur}
        style={{ background: previewBackgroundColor, color: previewTextColor }}
      />
            <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{pendingProfile.backgroundColor}</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Text:
      <input
        type="color"
        value={normalizeHex(previewTextColor)}
        onChange={handleTextColorChange}
        onBlur={handleTextColorBlur}
        style={{ background: previewBackgroundColor, color: previewTextColor, border: '1px solid #ccc', borderRadius: 4 }}
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
