
import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor, getLuminance } from "../utils/colorUtils";

const FONT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "Serif", value: "serif" },
  { label: "Sans-serif", value: "sans-serif" },
  { label: "Monospace", value: "monospace" },
  { label: "OpenDyslexic", value: "opendyslexic, sans-serif" },
];

export default function ProfilePage({ user, onLogout }) {
  // All hooks at the top
  const { backgroundColor, textColor, setBackgroundColor, setTextColor, font, setFont } = useContext(ThemeContext);
  const [activeTab, setActiveTab] = useState("settings");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Color logic for sidebar and avatar
  const getContainerBg = (bg, themeValue, step = 1) => {
    if (!bg) return themeValue === 'dark' ? '#232323' : '#f5f5f5';
    const lum = getLuminance(bg);
    const direction = lum < 0.5 ? 1 : -1;
    return stepColor(bg, themeValue, step, direction);
  };
  const sidebarBg = getContainerBg(backgroundColor, textColor === '#fff' ? 'dark' : 'light', 1);

  const tabList = [
    { key: "settings", label: "Settings", icon: "⚙️" },
    { key: "security", label: "Security", icon: "🔒" },
    { key: "notifications", label: "Notifications", icon: "🔔" },
  ];

  return (
    <div
      className="profile-page"
      style={{
        background: backgroundColor,
        color: textColor,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 32,
          width: sidebarExpanded ? 160 : 56,
          background: sidebarBg,
          transition: 'width 0.2s',
          borderRight: `1.5px solid ${textColor}22`,
          zIndex: 2,
        }}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
      >
        {/* Avatar */}
  <div style={{ width: 56, height: 56, borderRadius: '50%', background: backgroundColor, color: textColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, marginBottom: 24, userSelect: 'none', transition: 'color 0.2s, background 0.2s' }}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            (user?.username && user.username.length > 0)
              ? user.username[0].toUpperCase()
              : (user?.name && user.name.length > 0)
                ? user.name[0].toUpperCase()
                : '?'
          )}
        </div>
        {/* Sidebar tab buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {tabList.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                background: activeTab === tab.key ? getContainerBg(backgroundColor, textColor === '#fff' ? 'dark' : 'light', 3) : 'transparent',
                color: textColor,
                border: 'none',
                borderRadius: 8,
                fontWeight: activeTab === tab.key ? 700 : 400,
                fontSize: 18,
                padding: sidebarExpanded ? '10px 16px' : '10px 0',
                cursor: 'pointer',
                transition: 'background 0.2s, padding 0.2s',
                marginBottom: 2,
                justifyContent: sidebarExpanded ? 'flex-start' : 'center',
              }}
            >
              <span style={{ fontSize: 22, marginRight: sidebarExpanded ? 12 : 0 }}>{tab.icon}</span>
              {sidebarExpanded && <span>{tab.label}</span>}
            </button>
          ))}
        </div>
      </div>
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 48 }}>
        {user?.name && (
          <div style={{ fontWeight: 600, fontSize: 20, marginBottom: 24 }}>{user.name}</div>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div style={{ width: 320, maxWidth: '90vw', marginBottom: 32 }}>
            <h3>Theme & Appearance</h3>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                BG
                <input type="color" value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                Text
                <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} />
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block' }}>
                Font
                <select value={font} onChange={e => setFont(e.target.value)} style={{ marginLeft: 8 }}>
                  {FONT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block' }}>
                Timezone
                <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{ marginLeft: 8 }}>
                  {Intl.supportedValuesOf ?
                    Intl.supportedValuesOf('timeZone').map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    )) :
                    <option value={timezone}>{timezone}</option>
                  }
                </select>
              </label>
            </div>
          </div>
        )}

        {/* Security Tab (placeholder) */}
        {activeTab === "security" && (
          <div style={{ width: 320, maxWidth: '90vw', marginBottom: 32 }}>
            <h3>Security (coming soon)</h3>
          </div>
        )}

        {/* Notifications Tab (placeholder) */}
        {activeTab === "notifications" && (
          <div style={{ width: 320, maxWidth: '90vw', marginBottom: 32 }}>
            <h3>Notifications (coming soon)</h3>
          </div>
        )}

        <button
          onClick={onLogout}
          style={{
            padding: "10px 24px",
            borderRadius: 6,
            background: textColor,
            color: backgroundColor,
            border: "none",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          Log Out
        </button>
      </div>
    </div>
  );
}
