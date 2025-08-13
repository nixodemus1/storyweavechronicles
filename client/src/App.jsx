import React, { useState, useEffect } from "react";
import { stepColor } from "./utils/colorUtils";
import { ThemeContext } from "./themeContext";
import { BrowserRouter as Router, Routes, Route, useNavigate, Link } from "react-router-dom";

import LandingPage from "./pages/LandingPage";
import BooksViewer from "./components/BooksViewer";
import PDFReader from "./components/PDFReader";
import LoginRegisterPage from "./pages/LoginRegisterPage";
import ProfilePage from "./pages/ProfilePage";
import Logo1 from "./assets/file (1).svg";
import Logo2 from "./assets/file (2).svg";
import Logo3 from "./assets/file (3).svg";

export default function App() {
  const [theme, setTheme] = useState("light");
  const [backgroundColor, setBackgroundColor] = useState(() => {
    try {
      return localStorage.getItem('backgroundColor') || "#f5f6fa";
    } catch {
      return "#f5f6fa";
    }
  });
  const [textColor, setTextColor] = useState(() => {
    try {
      return localStorage.getItem('textColor') || "#23272f";
    } catch {
      return "#23272f";
    }
  });
  const [font, setFont] = useState("");
  // Persist user in localStorage
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Save user to localStorage whenever it changes
  useEffect(() => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
  }, [user]);
  // Save color changes to backend for logged-in user
  useEffect(() => {
    localStorage.setItem('backgroundColor', backgroundColor);
    localStorage.setItem('textColor', textColor);
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
    async function handleAuth(data) {
      // Always use backend's saved color values after login/register
      setBackgroundColor(data.backgroundColor || "#f5f6fa");
      setTextColor(data.textColor || "#23272f");
      // Fetch full user profile to ensure email is present
      let userProfile = data;
      if (data.username) {
        try {
          const res = await fetch('/api/get-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: data.username })
          });
          const profile = await res.json();
          if (profile.success) userProfile = profile;
        } catch (e) {console.error(e)}
      }
      setUser({
        username: userProfile.username,
        email: userProfile.email,
        secondaryEmails: userProfile.secondaryEmails || [],
        backgroundColor: userProfile.backgroundColor,
        textColor: userProfile.textColor,
        font: userProfile.font,
        timezone: userProfile.timezone,
        bookmarks: userProfile.bookmarks || [],
        notificationPrefs: userProfile.notificationPrefs || {},
        notificationHistory: userProfile.notificationHistory || [],
      });
      navigate("/");
    }
    return <LoginRegisterPage onAuth={handleAuth} {...props} />;
  }
  // On mount, if user exists but email is missing, fetch user profile
  useEffect(() => {
    if (user && user.username && !user.email) {
      fetch('/api/get-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username })
      })
        .then(res => res.json())
        .then(profile => {
          if (profile.success) {
            setUser(u => ({ ...u, ...profile }));
          }
        });
    }
  }, [user]);

  // Compute container color for header
  const headerContainerColor = stepColor(
    backgroundColor,
    theme === "dark" ? "dark" : "light",
    1
  );

  return (
    <ThemeContext.Provider value={{
      theme, toggleTheme, textColor, setTextColor, backgroundColor, setBackgroundColor,
      font, setFont, user, setUser
    }}>
      <Router>
        <div
          className={theme === "dark" ? "dark-mode" : "light-mode"}
          style={{ color: textColor, background: backgroundColor, minHeight: "100vh", fontFamily: font || undefined }}
        >
          <header className="header" style={{ position: 'relative', background: headerContainerColor, color: textColor, width: '100vw' }}>
            <Link
              to="/"
              className="logo"
              style={{ marginRight: 'auto', textDecoration: 'none', color: textColor, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
              title="Go to landing page"
            >
              {/* Swap Logo1/Logo2/Logo3 below to try different SVGs */}
              <div
                style={{
                  height: 72,
                  width: 72,
                  borderRadius: '50%',
                  background: backgroundColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  flexShrink: 0,
                  overflow: 'hidden',
                  objectFit: 'contain',
                }}
              >
                {/* Inline SVG logo from file (1).svg for visual test */}
                <svg
                  viewBox="0 0 500 500"
                  width={48}
                  height={48}
                  style={{ display: 'block' }}
                  xmlns="http://www.w3.org/2000/svg"
                  xmlnsXlink="http://www.w3.org/1999/xlink"
                >
                  {/* Background path uses backgroundColor */}
                  <path fill={backgroundColor} opacity="1.000000" stroke="none" d="M291.000000,501.000000 C194.000031,501.000000 97.500046,501.000000 1.000052,501.000000 C1.000035,334.333405 1.000035,167.666794 1.000017,1.000141 C167.666565,1.000094 334.333130,1.000094 500.999756,1.000047 C500.999847,167.666519 500.999847,334.333038 500.999939,500.999786 C431.166656,501.000000 361.333344,501.000000 291.000000,501.000000 M281.794159,288.801025 C282.045441,289.417114 282.276672,290.042267 282.551086,290.647858 C284.669342,295.322510 285.622162,301.771942 289.249634,304.166046 C292.890076,306.568726 299.219299,304.697296 304.332336,305.137543 C307.888336,305.443726 309.145599,304.030121 310.071198,300.778076 C316.627075,277.744263 323.385101,254.767929 330.085968,231.775406 C333.419434,220.337341 336.768311,208.903763 340.167694,197.271545 C331.505005,197.271545 323.408112,197.271545 315.009125,197.271545 C308.481323,221.846085 302.001892,246.238678 295.360229,271.241882 C294.447021,269.010040 293.669922,267.218475 292.974945,265.395599 C286.339081,247.990112 279.581360,230.628815 273.203705,213.129059 C271.899170,209.549530 270.024811,208.866425 266.678894,208.901077 C263.412476,208.934921 261.358551,209.315659 260.012329,213.017334 C253.589630,230.677750 246.767426,248.192947 240.078339,265.756378 C239.455383,267.392090 238.769684,269.003876 237.690857,271.670502 C236.922028,268.917511 236.468796,267.383759 236.065460,265.836975 C230.442368,244.271881 224.857101,222.696777 219.141586,201.156235 C218.741592,199.648743 217.438187,197.244507 216.472290,197.203522 C208.782822,196.877213 201.073364,197.021591 192.947861,197.021591 C202.427948,229.245499 211.665024,260.669281 220.924637,292.086426 C222.143051,296.220398 222.285019,301.968384 225.079987,303.989624 C228.096191,306.170807 233.692810,304.513580 238.074707,305.147003 C243.195160,305.887115 245.246780,303.542603 247.060425,299.101257 C253.204269,284.056061 259.810211,269.199585 266.603333,253.426437 C271.783386,265.533600 276.615417,276.827271 281.794159,288.801025 M163.029999,275.038818 C159.468384,284.520477 148.688721,287.364929 140.715439,280.513977 C137.421219,277.683411 135.068573,273.757019 132.153915,270.164154 C125.056007,273.182556 117.755325,276.287170 110.133041,279.528564 C115.329880,292.919250 125.128029,300.496735 137.987427,304.439362 C155.920258,309.937408 174.631454,303.342377 183.096176,288.829620 C191.622040,274.212036 187.972412,257.702942 173.705917,248.863632 C168.402023,245.577408 162.291000,243.592224 156.543030,241.024948 C152.009888,239.000275 147.201096,237.430710 143.002518,234.861786 C138.231079,231.942337 137.054977,227.491516 138.873672,223.292877 C140.706100,219.062531 146.205063,215.939133 150.914719,217.558456 C154.326172,218.731400 157.259171,221.424561 160.236206,223.664825 C161.326416,224.485229 161.929031,225.953583 162.840546,227.249313 C170.297226,224.128342 177.458542,221.131012 185.099243,217.933029 C183.507080,215.236084 182.411560,212.813141 180.820755,210.777176 C169.898285,196.798233 155.158585,193.739868 138.715530,196.961884 C125.817902,199.489166 117.042061,207.123428 114.563469,220.426468 C112.161888,233.316147 116.562050,243.883499 127.633530,250.988159 C132.748154,254.270248 138.593002,256.442566 144.184540,258.944244 C148.569244,260.905975 153.231079,262.297455 157.477112,264.505188 C161.171844,266.426270 163.657059,269.590332 163.029999,275.038818 M375.422882,200.892365 C354.907776,210.467163 343.030243,226.353119 342.326263,249.128128 C341.622711,271.889191 352.259796,288.926636 372.352661,299.301697 C392.600861,309.756866 412.976501,308.287476 433.470459,297.707916 C430.328217,290.342560 427.390839,283.457275 424.403320,276.454559 C406.928802,287.976990 386.217529,286.111542 374.347473,272.414825 C363.679413,260.105072 363.698669,241.525314 374.295380,229.381607 C384.415283,217.784256 405.516724,212.307266 424.071594,225.988144 C427.071991,218.909988 430.023773,211.946625 433.130463,204.617752 C414.429657,194.534119 395.625122,192.886124 375.422882,200.892365 M71.526169,296.538910 C71.928001,297.450104 72.245155,298.410950 72.745239,299.264587 C76.341911,305.404022 83.461800,307.844421 90.013458,305.222534 C96.501266,302.626190 99.908272,295.794495 98.145874,288.915527 C96.390182,282.062714 90.248482,277.909058 83.071175,278.720520 C74.842697,279.650848 70.424171,286.031097 71.526169,296.538910 z"/>
                  {/* Letter paths use textColor */}
                  <path fill={textColor} opacity="1.000000" stroke="none" d="M281.620789,288.460999 C276.615417,276.827271 271.783386,265.533600 266.603333,253.426437 C259.810211,269.199585 253.204269,284.056061 247.060425,299.101257 C245.246780,303.542603 243.195160,305.887115 238.074707,305.147003 C233.692810,304.513580 228.096191,306.170807 225.079987,303.989624 C222.285019,301.968384 222.143051,296.220398 220.924637,292.086426 C211.665024,260.669281 202.427948,229.245499 192.947861,197.021591 C201.073364,197.021591 208.782822,196.877213 216.472290,197.203522 C217.438187,197.244507 218.741592,199.648743 219.141586,201.156235 C224.857101,222.696777 230.442368,244.271881 236.065460,265.836975 C236.468796,267.383759 236.922028,268.917511 237.690857,271.670502 C238.769684,269.003876 239.455383,267.392090 240.078339,265.756378 C246.767426,248.192947 253.589630,230.677750 260.012329,213.017334 C261.358551,209.315659 263.412476,208.934921 266.678894,208.901077 C270.024811,208.866425 271.899170,209.549530 273.203705,213.129059 C279.581360,230.628815 286.339081,247.990112 292.974945,265.395599 C293.669922,267.218475 294.447021,269.010040 295.360229,271.241882 C302.001892,246.238678 308.481323,221.846085 315.009125,197.271545 C323.408112,197.271545 331.505005,197.271545 340.167694,197.271545 C336.768311,208.903763 333.419434,220.337341 330.085968,231.775406 C323.385101,254.767929 316.627075,277.744263 310.071198,300.778076 C309.145599,304.030121 307.888336,305.443726 304.332336,305.137543 C299.219299,304.697296 292.890076,306.568726 289.249634,304.166046 C285.622162,301.771942 284.669342,295.322510 282.551086,290.647858 C282.276672,290.042267 282.045441,289.417114 281.620789,288.460999 z"/>
                  <path fill={textColor} opacity="1.000000" stroke="none" d="M163.070679,274.636169 C163.657059,269.590332 161.171844,266.426270 157.477112,264.505188 C153.231079,262.297455 148.569244,260.905975 144.184540,258.944244 C138.593002,256.442566 132.748154,254.270248 127.633530,250.988159 C116.562050,243.883499 112.161888,233.316147 114.563469,220.426468 C117.042061,207.123428 125.817902,199.489166 138.715530,196.961884 C155.158585,193.739868 169.898285,196.798233 180.820755,210.777176 C182.411560,212.813141 183.507080,215.236084 185.099243,217.933029 C177.458542,221.131012 170.297226,224.128342 162.840546,227.249313 C161.929031,225.953583 161.326416,224.485229 160.236206,223.664825 C157.259171,221.424561 154.326172,218.731400 150.914719,217.558456 C146.205063,215.939133 140.706100,219.062531 138.873672,223.292877 C137.054977,227.491516 138.231079,231.942337 143.002518,234.861786 C147.201096,237.430710 152.009888,239.000275 156.543030,241.024948 C162.291000,243.592224 168.402023,245.577408 173.705917,248.863632 C187.972412,257.702942 191.622040,274.212036 183.096176,288.829620 C174.631454,303.342377 155.920258,309.937408 137.987427,304.439362 C125.128029,300.496735 115.329880,292.919250 110.133041,279.528564 C117.755325,276.287170 125.056007,273.182556 132.153915,270.164154 C135.068573,273.757019 137.421219,277.683411 140.715439,280.513977 C148.688721,287.364929 159.468384,284.520477 163.070679,274.636169 z"/>
                  <path fill={textColor} opacity="1.000000" stroke="none" d="M375.771545,200.739166 C395.625122,192.886124 414.429657,194.534119 433.130463,204.617752 C430.023773,211.946625 427.071991,218.909988 424.071594,225.988144 C405.516724,212.307266 384.415283,217.784256 374.295380,229.381607 C363.698669,241.525314 363.679413,260.105072 374.347473,272.414825 C386.217529,286.111542 406.928802,287.976990 424.403320,276.454559 C427.390839,283.457275 430.328217,290.342560 433.470459,297.707916 C412.976501,308.287476 392.600861,309.756866 372.352661,299.301697 C352.259796,288.926636 341.622711,271.889191 342.326263,249.128128 C343.030243,226.353119 354.907776,210.467163 375.771545,200.739166 z"/>
                  <path fill={textColor} opacity="1.000000" stroke="none" d="M71.396744,296.151917 C70.424171,286.031097 74.842697,279.650848 83.071175,278.720520 C90.248482,277.909058 96.390182,282.062714 98.145874,288.915527 C99.908272,295.794495 96.501266,302.626190 90.013458,305.222534 C83.461800,307.844421 76.341911,305.404022 72.745239,299.264587 C72.245155,298.410950 71.928001,297.450104 71.396744,296.151917 z"/>
                </svg>
              </div>
              <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: 1 }}>StoryWeave Chronicles</span>
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
            <Route path="/profile" element={<ProfilePage user={user} setUser={setUser} onLogout={async () => {
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