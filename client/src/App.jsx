// ...existing imports...

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import ReactDOM from "react-dom";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import { stepColor } from "./utils/colorUtils";
import { ThemeContext } from "./themeContext";
import LandingPage from "./pages/LandingPage";
import SearchResults from "./pages/SearchResults.jsx";
import PDFReader from "./pages/PDFReader";
import LoginRegisterPage from "./pages/LoginRegisterPage";
import ProfilePage from "./pages/ProfilePage";
import { ContainerDepthProvider } from "./components/ContainerDepthContext.jsx";

export default function App() {
  // Login button component (must be inside Router context)
  function LoginButton() {
    const navigate = useNavigate();
    return (
      <button
        style={{
          background: headerButtonColor,
          color: headerButtonTextColor,
          border: 'none',
          borderRadius: 8,
          padding: '8px 18px',
          fontWeight: 600,
          fontSize: 16,
          cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
        }}
        onClick={() => navigate('/login')}
      >
        Login
      </button>
    );
  }
  // Track theme and user settings (declare all state hooks first)
  const [theme, setTheme] = useState("light");
  const [backgroundColor, setBackgroundColor] = useState("#fff");
  const [textColor, setTextColor] = useState("#222");
  const [font, setFont] = useState("");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

  // Track user, persist in localStorage
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  // Save user to localStorage on change
  useEffect(() => {
    window.setUser = setUser;
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
    return () => { delete window.setUser; };
  }, [user]);

  // Sync context colors ONLY when user object changes (not on every theme change)
  useEffect(() => {
    if (user) {
      if (user.backgroundColor) setBackgroundColor(user.backgroundColor);
      if (user.textColor) setTextColor(user.textColor);
      if (user.font) setFont(user.font);
      if (user.timezone) setTimezone(user.timezone);
    }
  }, [user]);

  // Navigation function for notification clicks
  function useAppNavigate() {
    const navigate = useNavigate();
    return (to) => {
      if (typeof to === 'string') navigate(to);
    };
  }
  // Header avatar (shows if user exists)
  function HeaderAvatar() {
    return (
      <Link
        to="/profile"
        className="user-profile-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          marginLeft: 8,
          textDecoration: 'none',
          color: textColor,
          minWidth: 0,
          maxWidth: 220,
          flexShrink: 1
        }}
        title="View profile"
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: backgroundColor,
            color: textColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 15,
            marginTop: 4,
            fontWeight: 700,
            fontSize: 18,
            border: '1.5px solid #888',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
          }}
        >
          {user && user.username ? user.username[0].toUpperCase() : "?"}
        </div>
      </Link>
    );
  }


  // Custom hook for notifications
  function useNotifications(user) {
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hasUnread, setHasUnread] = useState(false);
    const lastIdsRef = useRef([]);

    // Fetch notifications only if user changes or on manual trigger
    const fetchNotifications = async () => {
      if (!user || !user.username) return;
      setLoading(true);
      try {
        const res = await fetch('/api/get-notification-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user.username })
        });
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (err) {
          console.log('Error parsing notifications response:', err);
          setLoading(false);
          setNotifications([]);
          return;
        }
        if (data.success && Array.isArray(data.history)) {
          const newIds = data.history.map(n => n.id).sort();
          if (JSON.stringify(newIds) !== JSON.stringify(lastIdsRef.current)) {
            setNotifications(data.history);
            lastIdsRef.current = newIds;
            setHasUnread(data.history.some(n => !n.read));
          }
        }
      } catch (err) {
        console.log('Error fetching notifications:', err);
        setNotifications([]);
      }
      setLoading(false);
    };

    // Fetch on user change
    useEffect(() => {
      fetchNotifications();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.username]);

    // Dismiss notification
    const handleDismiss = async (id) => {
      await fetch(`/api/delete-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, notificationId: id })
      });
      // Refetch notifications from backend to update dropdown
      const res = await fetch(`/api/get-notification-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, dropdownOnly: true })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.history)) {
        setNotifications(data.history);
        lastIdsRef.current = data.history.map(n => n.id).sort();
      }
      // Update user profile notifications
      if (typeof window.setUser === 'function') {
        window.setUser(u => {
          if (!u) return u;
          return {
            ...u,
            notifications: notifications.filter(n => n.id !== id)
          };
        });
      }
    };

    // Handle notification click (navigate if link, dismiss if not)
    const handleNotificationClick = (notification, navigate) => {
      if (notification.link) {
        // Mark as read and navigate
        fetch(`/api/mark-notification-read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user.username, notification_id: notification.id })
        });
        if (navigate) navigate(notification.link);
        // Optionally, remove from local state or mark as read
        setNotifications(notifications.map(n => n.id === notification.id ? { ...n, read: true } : n));
      }
    };

    return { notifications, loading, hasUnread, fetchNotifications, handleDismiss, handleNotificationClick };
  }

  // Notification button and dropdown
  function NotificationButton() {
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef(null);
  const { notifications, loading, fetchNotifications, handleDismiss, handleNotificationClick } = useNotifications(user);
    const appNavigate = useAppNavigate();

    // Close dropdown on outside click
    useEffect(() => {
      function handleClick(e) {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
          setShowDropdown(false);
        }
      }
      if (showDropdown) {
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
      }
    }, [showDropdown]);

    // Only show unread indicator if there are unread and not dismissed notifications
    const hasActiveUnread = notifications.some(n => !n.dismissed && !n.read);
    // Helper to generate a unique key for each notification
    function getNotificationKey(n, idx) {
      // Use id if present, else fallback to timestamp + idx
      return n.id ? `${n.id}_${idx}` : `${n.timestamp}_${idx}`;
    }
    // Modified notification click handler: dismiss on link click
    function handleNotificationClickAndDismiss(n, navigate) {
      if (n.link) {
        handleDismiss(n.id || n.timestamp);
        navigate(n.link);
      }
    }
    return (
      <>
        <button
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1.7rem',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            color: hasActiveUnread ? '#f5c518' : headerButtonTextColor,
          }}
          onClick={() => {
            setShowDropdown(v => !v);
            if (!showDropdown) fetchNotifications();
          }}
          title="Notifications"
          aria-label="Notifications"
        >
          <span role="img" aria-label="bell">🔔</span>
          {hasActiveUnread && (
            <span style={{ position: 'absolute', top: 4, right: 4, width: 10, height: 10, borderRadius: '50%', background: '#f5c518', border: '1px solid #fff' }}></span>
          )}
        </button>
        {showDropdown && (
          typeof document !== 'undefined' && document.body ?
            ReactDOM.createPortal(
              <div
                ref={dropdownRef}
                style={{
                  position: 'fixed',
                  top: 70,
                  right: 60,
                  minWidth: 320,
                  background: headerButtonColor,
                  color: headerButtonTextColor,
                  borderRadius: 10,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
                  zIndex: 9999,
                  padding: 18,
                  maxHeight: 400,
                  overflowY: 'auto',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 18 }}>Notifications</span>
                  <button
                    style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: headerButtonTextColor }}
                    onClick={() => setShowDropdown(false)}
                    title="Close"
                  >✖</button>
                  <button
                    style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: headerButtonTextColor, marginLeft: 8 }}
                    onClick={fetchNotifications}
                    title="Refresh"
                  >⟳</button>
                </div>
                {loading ? (
                  <div>Loading...</div>
                ) : notifications.length === 0 ? (
                  <div style={{ color: '#888', fontSize: 15 }}>No new notifications.</div>
                ) : (
                  notifications.filter(n => !n.dismissed).map((n, idx) => (
                    <div
                      key={getNotificationKey(n, idx)}
                      style={{ background: stepColor(headerButtonColor, theme, 1), color: headerButtonTextColor, borderRadius: 7, marginBottom: 10, padding: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      onClick={() => n.link ? handleNotificationClickAndDismiss(n, appNavigate) : null}
                    >
                      {n.link ? (
                        <div style={{ flex: 1, marginRight: 10, cursor: 'pointer' }}>
                          <div style={{ fontWeight: 600 }}>{n.title || 'Notification'}</div>
                          <div style={{ fontSize: 14 }}>{n.message}</div>
                          <div style={{ fontSize: 12, color: '#888' }}>{new Date(n.timestamp).toLocaleString()}</div>
                        </div>
                      ) : (
                        <div style={{ flex: 1, marginRight: 10 }}>
                          <div style={{ fontWeight: 600 }}>{n.title || 'Notification'}</div>
                          <div style={{ fontSize: 14 }}>{n.message}</div>
                          <div style={{ fontSize: 12, color: '#888' }}>{new Date(n.timestamp).toLocaleString()}</div>
                        </div>
                      )}
                      {!n.link && (
                        <button
                          style={{ background: '#ffe0e0', color: '#c00', border: '1px solid #c00', borderRadius: 6, padding: '4px 10px', fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}
                          onClick={e => {
                            e.stopPropagation();
                            handleDismiss(n.id || n.timestamp);
                          }}
                          title="Dismiss"
                        >Dismiss</button>
                      )}
                    </div>
                  ))
                )}
              </div>,
              document.body
            ) : null
        )}
      </>
    );
  }
  // Header colors
  const headerContainerColor = stepColor(backgroundColor, theme, 2);
  const headerTextColor = theme === "dark" ? "#fff" : stepColor(textColor, theme, 1);
  const headerButtonColor = stepColor(headerContainerColor, theme, 1);
  const headerButtonTextColor = headerTextColor;

  // Header logo
  function HeaderLogo() {
    return (
      <Link to="/" className="logo" style={{ display: "flex", alignItems: "center", textDecoration: "none", color: headerTextColor }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: "50%", background: backgroundColor, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", marginRight: 12, overflow: "hidden" }}>
          <svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="48" height="48" viewBox="0 0 500 500" style={{ display: "block" }}>
            <path fill={headerTextColor} opacity="1.000000" stroke="none" d="M291.000000,501.000000 C194.000031,501.000000 97.500046,501.000000 1.000052,501.000000 C1.000035,334.333405 1.000035,167.666794 1.000017,1.000141 C167.666565,1.000094 334.333130,1.000094 500.999756,1.000047 C500.999847,167.666519 500.999847,334.333038 500.999939,500.999786 C431.166656,501.000000 361.333344,501.000000 291.000000,501.000000 z" />
            <path fill={backgroundColor} opacity="1.000000" stroke="none" d="M281.620789,288.460999 C276.615417,276.827271 271.783386,265.533600 266.603333,253.426437 C259.810211,269.199585 253.204269,284.056061 247.060425,299.101257 C245.246780,303.542603 243.195160,305.887115 238.074707,305.147003 C233.692810,304.513580 228.096191,306.170807 225.079987,303.989624 C222.285019,301.968384 222.143051,296.220398 220.924637,292.086426 C211.665024,260.669281 202.427948,229.245499 192.947861,197.021591 C201.073364,197.021591 208.782822,196.877213 216.472290,197.203522 C217.438187,197.244507 218.741592,199.648743 219.141586,201.156235 C224.857101,222.696777 230.442368,244.271881 236.065460,265.836975 C236.468796,267.383759 236.922028,268.917511 237.690857,271.670502 C238.769684,269.003876 239.455383,267.392090 240.078339,265.756378 C246.767426,248.192947 253.589630,230.677750 260.012329,213.017334 C261.358551,209.315659 263.412476,208.934921 266.678894,208.901077 C270.024811,208.866425 271.899170,209.549530 273.203705,213.129059 C279.581360,230.628815 286.339081,247.990112 292.974945,265.395599 C293.669922,267.218475 294.447021,269.010040 295.360229,271.241882 C302.001892,246.238678 308.481323,221.846085 315.009125,197.271545 C323.408112,197.271545 331.505005,197.271545 340.167694,197.271545 C336.768311,208.903763 333.419434,220.337341 330.085968,231.775406 C323.385101,254.767929 316.627075,277.744263 310.071198,300.778076 C309.145599,304.030121 307.888336,305.443726 304.332336,305.137543 C299.219299,304.697296 292.890076,306.568726 289.249634,304.166046 C285.622162,301.771942 284.669342,295.322510 282.551086,290.647858 C282.276672,290.042267 282.045441,289.417114 281.620789,288.460999 z M163.070679,274.636169 C163.657059,269.590332 161.171844,266.426270 157.477112,264.505188 C153.231079,262.297455 148.569244,260.905975 144.184540,258.944244 C138.593002,256.442566 132.748154,254.270248 127.633530,250.988159 C116.562050,243.883499 112.161888,233.316147 114.563469,220.426468 C117.042061,207.123428 125.817902,199.489166 138.715530,196.961884 C155.158585,193.739868 169.898285,196.798233 180.820755,210.777176 C182.411560,212.813141 183.507080,215.236084 185.099243,217.933029 C177.458542,221.131012 170.297226,224.128342 162.840546,227.249313 C161.929031,225.953583 161.326416,224.485229 160.236206,223.664825 C157.259171,221.424561 154.326172,218.731400 150.914719,217.558456 C146.205063,215.939133 140.706100,219.062531 138.873672,223.292877 C137.054977,227.491516 138.231079,231.942337 143.002518,234.861786 C147.201096,237.430710 152.009888,239.000275 156.543030,241.024948 C162.291000,243.592224 168.402023,245.577408 173.705917,248.863632 C187.972412,257.702942 191.622040,274.212036 183.096176,288.829620 C174.631454,303.342377 155.920258,309.937408 137.987427,304.439362 C125.128029,300.496735 115.329880,292.919250 110.133041,279.528564 C117.755325,276.287170 125.056007,273.182556 132.153915,270.164154 C135.068573,273.757019 137.421219,277.683411 140.715439,280.513977 C148.688721,287.364929 159.468384,284.520477 163.070679,274.636169 z M375.771545,200.739166 C395.625122,192.886124 414.429657,194.534119 433.130463,204.617752 C430.023773,211.946625 427.071991,218.909988 424.071594,225.988144 C405.516724,212.307266 384.415283,217.784256 374.295380,229.381607 C363.698669,241.525314 363.679413,260.105072 374.347473,272.414825 C386.217529,286.111542 406.928802,287.976990 424.403320,276.454559 C427.390839,283.457275 430.328217,290.342560 433.470459,297.707916 C412.976501,308.287476 392.600861,309.756866 372.352661,299.301697 C352.259796,288.926636 341.622711,271.889191 342.326263,249.128128 C343.030243,226.353119 354.907776,210.467163 375.771545,200.739166 z M71.396744,296.151917 C70.424171,286.031097 74.842697,279.650848 83.071175,278.720520 C90.248482,277.909058 96.390182,282.062714 98.145874,288.915527 C99.908272,295.794495 96.501266,302.626190 90.013458,305.222534 C83.461800,307.844421 76.341911,305.404022 72.745239,299.264587 C72.245155,298.410950 71.928001,297.450104 71.396744,296.151917 z" />
          </svg>
        </span>
        <span style={{ fontWeight: 700, fontSize: 24, letterSpacing: 1, color: headerTextColor }}>StoryWeave Chronicles</span>
      </Link>
    );
  }

  // Theme toggle button
  function ThemeToggleButton() {
    async function handleToggle() {
      const newTheme = theme === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
      // Set strict defaults for theme
      const newBg = newTheme === 'dark' ? '#232323' : '#fff';
      const newText = newTheme === 'dark' ? '#fff' : '#222';
      setBackgroundColor(newBg);
      setTextColor(newText);
      // If user is logged in, update user object and backend
      if (user?.username) {
        // Update user object immediately for instant UI feedback
        setUser(u => u ? { ...u, backgroundColor: newBg, textColor: newText } : u);
        // Sync to backend
        try {
          await fetch(import.meta.env.VITE_HOST_URL + '/api/update-colors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username, backgroundColor: newBg, textColor: newText })
          });
        } catch (err) {
          console.log('Error updating user colors:', err);
        }
      }
    }
    return (
      <button
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '1.7rem',
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: headerButtonTextColor,
        }}
        onClick={handleToggle}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? '🌙' : '☀️'}
      </button>
    );
  }

  // Main content routes
  function MainContent() {
    const navigate = useNavigate();
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/read/:id" element={<PDFReader />} />
        <Route path="/login" element={<LoginRegisterPage onAuth={data => {
          if (data.success) {
            const userObj = {
              username: data.username,
              email: data.email,
              backgroundColor: data.backgroundColor,
              textColor: data.textColor,
              bookmarks: data.bookmarks,
              secondaryEmails: data.secondaryEmails,
              font: data.font,
              timezone: data.timezone,
              notificationPrefs: data.notificationPrefs,
              notificationHistory: data.notificationHistory,
              is_admin: data.is_admin
            };
            setUser(userObj);
            localStorage.setItem('user', JSON.stringify(userObj));
            // Redirect after login
            if (window.location.pathname === '/login') {
              navigate('/');
            }
          }
        }} />} />
        <Route path="/profile" element={<ProfilePage user={user} setUser={setUser} onLogout={() => {
          setUser(null);
          localStorage.removeItem('user');
          window.location.href = "/";
        }} />} />
        <Route path="/register" element={<LoginRegisterPage onAuth={data => {
          if (data.success) {
            const userObj = {
              username: data.username,
              email: data.email,
              backgroundColor: data.backgroundColor,
              textColor: data.textColor,
              bookmarks: data.bookmarks,
              secondaryEmails: data.secondaryEmails,
              font: data.font,
              timezone: data.timezone,
              notificationPrefs: data.notificationPrefs,
              notificationHistory: data.notificationHistory,
              is_admin: data.is_admin
            };
            setUser(userObj);
            localStorage.setItem('user', JSON.stringify(userObj));
            // Redirect after register
            navigate('/profile');
          }
        }} mode="register" />} />
      </Routes>
    );
  }

  return (
    <ThemeContext.Provider value={{
      theme,
      backgroundColor,
      textColor,
      setTheme,
      setBackgroundColor,
      setTextColor,
      font,
      setFont,
      timezone,
      setTimezone,
      headerButtonColor,
      headerButtonTextColor,
      user,
      setUser,
    }}>
      <ContainerDepthProvider>
        <Router>
          <div style={{ background: backgroundColor, color: textColor, minHeight: '100vh', fontFamily: font || 'inherit' }} className={theme === "dark" ? "dark-mode" : "light-mode"}>
            <header className="header" style={{ background: headerContainerColor, color: headerTextColor, display: 'flex', justifyContent: 'center', minHeight: 64, zIndex: 10, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 2200, padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <HeaderLogo />
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20,
                    height: 48,
                    paddingRight: 0,
                    marginRight: 0
                  }}
                >
                  {!user && <LoginButton />}
                  {user && <HeaderAvatar />}
                  <ThemeToggleButton />
                  {user && <NotificationButton />}
                </div>
              </div>
            </header>
            <MainContent />
            <div style={{ position: 'fixed', bottom: 8, right: 16, fontSize: 13, color: '#888', background: '#fff8', borderRadius: 6, padding: '4px 10px', zIndex: 9999 }}>
              Timezone: {timezone}
            </div>
          </div>
        </Router>
      </ContainerDepthProvider>
    </ThemeContext.Provider>
  );
}