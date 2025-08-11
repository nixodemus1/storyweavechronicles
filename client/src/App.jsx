import React, { useState } from "react";
import { ThemeContext } from "./themeContext";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import BooksViewer from "./components/BooksViewer";
import PDFReader from "./components/PDFReader";
export default function App() {
  const [theme, setTheme] = useState("light");
  const [textColor, setTextColor] = useState("#23272f");
  const [backgroundColor, setBackgroundColor] = useState("#f5f6fa");

  // Update default colors when theme changes
  React.useEffect(() => {
    if (theme === "dark") {
      setTextColor("#f5f6fa");
      setBackgroundColor("#181a20");
    } else {
      setTextColor("#23272f");
      setBackgroundColor("#f5f6fa");
    }
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === "light" ? "dark" : "light"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, textColor, setTextColor, backgroundColor, setBackgroundColor }}>
      <Router>
        <div
          className={theme === "dark" ? "dark-mode" : "light-mode"}
          style={{ color: textColor, background: backgroundColor, minHeight: "100vh" }}
        >
          <header className="header" style={{ position: 'relative', background: backgroundColor, color: textColor, width: '100vw' }}>
            <h1 className="logo" style={{ marginRight: 'auto' }}>StoryWeave Chronicles</h1>
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
            <a
              href="/authorize"
              className="login-btn"
            >
              Log In
            </a>
          </header>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/view-pdf/:id" element={<BooksViewer />} />
            <Route path="/read/:id" element={<PDFReader />} />
          </Routes>
        </div>
      </Router>
    </ThemeContext.Provider>
  );
}
