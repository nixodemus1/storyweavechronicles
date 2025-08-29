import React, { useContext, useState, useRef } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor } from "../utils/colorUtils";
import AccountTabContent from "../components/AccountTabContent";
import NotificationsTab from "../components/NotificationsTab";
import AdminTabContent from "../components/AdminTabContent";
import SettingsTabContent from "../components/SettingsTabContent";
import SecurityTabContent from "../components/SecurityTabContent";

function ProfileSidebar({ user, sidebarExpanded, activeTab, setActiveTab, backgroundColor, textColor, isAdmin, setUser, sidebarRef }) {
  const tabs = [
    { key: 'settings', icon: '⚙️', label: 'Settings' },
    { key: 'security', icon: '🔒', label: 'Security' },
    { key: 'account', icon: '👤', label: 'Account' },
    { key: 'notifications', icon: '🔔', label: 'Notifications' },
  ];
  if (isAdmin) {
    tabs.push({ key: 'admin', icon: '🛡️', label: 'Admin' });
  }
  // Use ThemeContext for backgroundColor and theme
  const { backgroundColor: contextBg, theme: contextTheme } = useContext(ThemeContext);
  const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || contextBg || '#fff';
  const sidebarBg = stepColor(cssBg, contextTheme || 'light', 1);
  // Add redirect on logout
  const handleLogout = () => {
    setUser(null);
    window.location.href = "/";
  };
  return (
    <aside
      ref={sidebarRef}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        height: '100vh',
        width: sidebarExpanded ? 180 : 56,
  background: sidebarBg,
  color: "var(--sidebar-text-color)",
        transition: 'width 0.2s',
        display: 'flex',
        flexDirection: 'column',
        alignItems: sidebarExpanded ? 'flex-start' : 'center',
        padding: 0,
        borderRight: '1px solid #eee',
        gap: 0,
        zIndex: 2, // Lower than header (header is 10)
        boxSizing: 'border-box',
        boxShadow: '0 0 0 0', // Remove shadow so header is visually above
      }}
    >
  {/* Spacer for header height (assume 64px), plus extra for avatar. Increase height to move content down. */}
  <div style={{ height: 120, minHeight: 120, width: '100%' }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28, width: '100%' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: stepColor(cssBg, contextTheme || 'light', 1),
            color: "var(--text-color)",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 6,
            fontWeight: 700,
            fontSize: 24,
            border: `2px solid var(--text-color)`,
          }}
        >
          {user?.username ? user.username[0].toUpperCase() : '?'}
        </div>
  {sidebarExpanded && <div style={{ fontWeight: 600, fontSize: 16, color: "var(--text-color)" }}>{user?.username}</div>}
      </div>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: activeTab === tab.key ? "var(--text-color)" : 'none',
              color: activeTab === tab.key ? "var(--background-color)" : "var(--text-color)",
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 15,
              padding: sidebarExpanded ? '10px 18px' : '10px 0',
              width: '100%',
              marginBottom: 4,
              cursor: 'pointer',
              textAlign: sidebarExpanded ? 'left' : 'center',
              gap: sidebarExpanded ? 12 : 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarExpanded ? 'flex-start' : 'center', // Center icons in collapsed mode
            }}
          >
            <span style={{ marginRight: sidebarExpanded ? 12 : 0 }}>{tab.icon}</span>
            {sidebarExpanded && tab.label}
          </button>
        ))}
      </div>
      {/* Logout button, always visible and accessible */}
      <div style={{ flex: 1 }} />
      <button
        onClick={handleLogout}
        style={{
          background: '#c00',
          color: '#fff', // keep for destructive actions
          border: 'none',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 15,
          padding: sidebarExpanded ? '10px 18px' : '10px 0',
          width: '100%',
          marginBottom: 12,
          cursor: 'pointer',
          textAlign: sidebarExpanded ? 'left' : 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarExpanded ? 'flex-start' : 'center',
        }}
        title="Log out"
      >
        <span style={{ marginRight: sidebarExpanded ? 12 : 0 }}>🚪</span>
        {sidebarExpanded && 'Log out'}
      </button>
    </aside>
  );
}

function ProfilePage({ user, setUser }) {
  // Use context for user and backgroundColor
  const { user: contextUser, backgroundColor, theme } = useContext(ThemeContext);
  // Persist activeTab in localStorage so it survives refreshes and re-renders
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem('profileActiveTab') || 'settings';
    } catch {
      return 'settings';
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('profileActiveTab', activeTab);
    } catch {console.log("so something went wrooonnngggg.....")}
  }, [activeTab]);
  // Sidebar expansion state should persist and not reset on unrelated re-renders
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  // Use contextUser if available, fallback to prop
  const effectiveUser = contextUser || user;
  const isAdmin = effectiveUser?.is_admin;

  // Prevent sidebar from expanding on unrelated state changes
  const sidebarRef = React.useRef();
  React.useEffect(() => {
    function handleMouseEnter() {
      setSidebarExpanded(true);
    }
    function handleMouseLeave() {
      setSidebarExpanded(false);
    }
    const sidebarEl = sidebarRef.current;
    if (sidebarEl) {
      sidebarEl.addEventListener('mouseenter', handleMouseEnter);
      sidebarEl.addEventListener('mouseleave', handleMouseLeave);
    }
    return () => {
      if (sidebarEl) {
        sidebarEl.removeEventListener('mouseenter', handleMouseEnter);
        sidebarEl.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, []);

  // Ref for SettingsTabContent
  const settingsTabRef = useRef();

  // Save profile changes when switching away from settings tab
  const handleTabSwitch = (newTab) => {
    if (activeTab === 'settings' && newTab !== 'settings' && settingsTabRef.current?.savePendingProfile) {
      settingsTabRef.current.savePendingProfile();
    }
    setActiveTab(newTab);
  };

  // Save profile changes on logout
  const handleLogout = () => {
    if (activeTab === 'settings' && settingsTabRef.current?.savePendingProfile) {
      settingsTabRef.current.savePendingProfile();
    }
    setUser(null);
    window.location.href = "/";
  };

  // Save profile changes on page unload
  React.useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (activeTab === 'settings' && settingsTabRef.current?.savePendingProfile) {
        settingsTabRef.current.savePendingProfile();
      } else {
        //place holder for diagnostic logging. please delete when you know everything works
        console.log(e);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [activeTab]);

  let tabContent = null;
  switch (activeTab) {
    case 'settings':
      tabContent = <SettingsTabContent ref={settingsTabRef} user={user} setUser={setUser} />;
      break;
    case 'security':
      tabContent = <SecurityTabContent user={user} setUser={setUser} />;
      break;
    case 'account':
      tabContent = <AccountTabContent user={user} />;
      break;
    case 'notifications':
      tabContent = <NotificationsTab user={user} setUser={setUser} />;
      break;
    case 'admin':
      tabContent = isAdmin ? <AdminTabContent user={user} /> : null;
      break;
    default:
      tabContent = <SettingsTabContent ref={settingsTabRef} user={user} setUser={setUser} />;
  }

  return (
  <div style={{ display: 'flex', minHeight: '100vh', background: stepColor(getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor, theme, 0), color: "var(--text-color)" }}>
      <ProfileSidebar
        user={effectiveUser}
        sidebarExpanded={sidebarExpanded}
        activeTab={activeTab}
        setActiveTab={handleTabSwitch}
  // backgroundColor and textColor props can be removed if not used in child
        isAdmin={isAdmin}
        setUser={setUser}
        sidebarRef={sidebarRef}
        handleLogout={handleLogout}
      />
      <main style={{
        marginLeft: sidebarExpanded ? 180 : 56,
        padding: '32px 24px',
        width: '100%',
        boxSizing: 'border-box',
        background: stepColor(getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor, theme, 0),
        color: 'var(--text-color)'
      }}>
        {tabContent}
      </main>
    </div>
  );
}

export default ProfilePage;
