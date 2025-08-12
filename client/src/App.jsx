import React, { useState, useEffect } from "react";
import { stepColor } from "./utils/colorUtils";
import { ThemeContext } from "./themeContext";
import { BrowserRouter as Router, Routes, Route, useNavigate, Link } from "react-router-dom";

import LandingPage from "./pages/LandingPage";
import BooksViewer from "./components/BooksViewer";
import PDFReader from "./components/PDFReader";
import LoginRegisterPage from "./pages/LoginRegisterPage";
import ProfilePage from "./pages/ProfilePage";

export default function App() {
  const [theme, setTheme] = useState("light");
  const [textColor, setTextColor] = useState("#23272f");
  const [backgroundColor, setBackgroundColor] = useState("#f5f6fa");
  const [font, setFont] = useState("");
  const [user, setUser] = useState(null); // { username, email, ... }

  // Save color changes to backend for logged-in user
  useEffect(() => {
    if (user && user.username) {
      fetch("/api/update-colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: user.username,
          backgroundColor,
          textColor,
        }),
      });
    }
  }, [backgroundColor, textColor, user]);

  // Update default colors when theme changes
  useEffect(() => {
    if (theme === "dark") {
      setTextColor("#f5f6fa");
      setBackgroundColor("#181a20");
    } else {
      setTextColor("#23272f");
      setBackgroundColor("#f5f6fa");
    }
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === "light" ? "dark" : "light"));

  // AuthWrapper handles navigation after login/register
  function AuthWrapper(props) {
    const navigate = useNavigate();
    function handleAuth(data) {
      // Always use backend's saved color values after login/register
      setBackgroundColor(data.backgroundColor || "#f5f6fa");
      setTextColor(data.textColor || "#23272f");
      setUser({
        username: data.username,
        email: data.email,
      });
      navigate("/");
    }
    return <LoginRegisterPage onAuth={handleAuth} {...props} />;
  }

  // Compute container color for header
  const headerContainerColor = stepColor(
    backgroundColor,
    theme === "dark" ? "dark" : "light",
    1
  );

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, textColor, setTextColor, backgroundColor, setBackgroundColor, font, setFont }}>
      <Router>
        <div
          className={theme === "dark" ? "dark-mode" : "light-mode"}
          style={{ color: textColor, background: backgroundColor, minHeight: "100vh", fontFamily: font || undefined }}
        >
          <header className="header" style={{ position: 'relative', background: headerContainerColor, color: textColor, width: '100vw' }}>
            <Link
              to="/"
              className="logo"
              style={{ marginRight: 'auto', textDecoration: 'none', color: textColor, cursor: 'pointer' }}
              title="Go to landing page"
            >
              StoryWeave Chronicles
            </Link>
            <label style={{ marginRight: 8 }}>
              <span style={{ fontSize: '0.9rem', marginRight: 4 }}>Text</span>
              <input
                type="color"
                value={textColor}
                onChange={e => setTextColor(e.target.value)}
                style={{ verticalAlign: 'middle', marginRight: 12 }}
                title="Pick text color"
              />
            </label>
            <label style={{ marginRight: 16 }}>
              <span style={{ fontSize: '0.9rem', marginRight: 4 }}>BG</span>
              <input
                type="color"
                value={backgroundColor}
                onChange={e => setBackgroundColor(e.target.value)}
                style={{ verticalAlign: 'middle', marginRight: 8 }}
                title="Pick background color"
              />
            </label>
            <button
              className="theme-toggle-btn"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
              style={{ marginRight: 16, fontSize: '1.5rem', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {theme === "dark" ? "🌙" : "☀️"}
            </button>
            {user ? (
              <Link
                to="/profile"
                className="user-profile-header"
                style={{ display: 'flex', alignItems: 'center', marginLeft: 8, textDecoration: 'none', color: textColor }}
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
                    marginRight: 8,
                    fontWeight: 700,
                    fontSize: 18,
                    border: '1.5px solid #888',
                  }}
                >
                  {user.username ? user.username[0].toUpperCase() : "?"}
                </div>
                <span style={{ fontWeight: 600 }}>{user.username || user.email}</span>
              </Link>
            ) : (
              <Link
                to="/login"
                className="login-btn"
                style={{ marginLeft: 8 }}
              >
                Log In
              </Link>
            )}
          </header>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/view-pdf/:id" element={<BooksViewer />} />
            <Route path="/read/:id" element={<PDFReader />} />
            <Route path="/login" element={<AuthWrapper />} />
            <Route path="/profile" element={<ProfilePage user={user} onLogout={async () => {
              // Save color changes before logout
              if (user && user.username) {
                await fetch("/api/update-colors", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    username: user.username,
                    backgroundColor,
                    textColor,
                  }),
                });
              }
              setUser(null);
              window.location.href = "/";
            }} />} />
          </Routes>
        </div>
      </Router>
    </ThemeContext.Provider>
  );
}