import React, { useState, useContext } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor, getLuminance } from "../utils/colorUtils";


export default function LoginRegisterPage({ onAuth }) {
  const { theme, backgroundColor, textColor } = useContext(ThemeContext);
  const [mode, setMode] = useState("login"); // "login" or "register"
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // For registration, allow user to pick colors
  const [regBg, setRegBg] = useState(backgroundColor);
  const [regText, setRegText] = useState(textColor);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const baseUrl = import.meta.env.VITE_HOST_URL || "";
    const url = baseUrl + (mode === "login" ? "/api/login" : "/api/register");
    const body = mode === "login"
      ? { username, password }
      : { username, email, password, backgroundColor: regBg, textColor: regText };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        // If JSON parsing fails, show status and response text
        console.log("JSON parsing error:", jsonErr);
        const text = await res.text();
        setError(`HTTP ${res.status} ${res.statusText}. Response: ${text ? text : "(empty)"}`);
        return;
      }
      if (!data.success) {
        setError(data.message || `Unknown error (HTTP ${res.status})`);
      } else {
        setError("");
        if (onAuth) onAuth(data);
        // Optionally redirect or update app state here
      }
    } catch (err) {
      setError("Network error: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Use the same container color logic as LandingPage
  function getContainerBg(bg, theme, step = 1) {
    if (!bg) return theme === 'dark' ? '#232323' : '#f5f5f5';
    const lum = getLuminance(bg);
    const direction = lum < 0.5 ? 1 : -1;
    return stepColor(bg, theme, step, direction);
  }
  const containerBg = getContainerBg(backgroundColor, theme, 1);
  // Use a slightly different step for button backgrounds for visual separation
  const buttonBg = getContainerBg(backgroundColor, theme, 2);
  const buttonText = getLuminance(buttonBg) < 0.5 ? '#fff' : '#232323';

  return (
    <div
      className={`login-register-page ${theme}-mode`}
      style={{ background: backgroundColor, color: textColor, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: containerBg,
          color: textColor,
          borderRadius: 12,
          boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
          padding: 32,
          minWidth: 320,
          maxWidth: 400,
        }}
      >
        <h2 style={{ textAlign: "center", marginBottom: 16 }}>
          {mode === "login" ? "Login" : "Register"}
        </h2>
        <div style={{ marginBottom: 16 }}>
          <label>{mode === "login" ? "Username or Email" : "Username"}</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{ width: "100%", padding: 8, marginTop: 4, borderRadius: 4, border: "1px solid #ccc" }}
            autoComplete="username"
            required
            placeholder={mode === "login" ? "Enter your username or email" : "Choose a username"}
          />
        </div>
        {mode === "register" && (
          <div style={{ marginBottom: 16 }}>
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ width: "100%", padding: 8, marginTop: 4, borderRadius: 4, border: "1px solid #ccc" }}
              autoComplete="email"
              required
            />
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: "100%", padding: 8, marginTop: 4, borderRadius: 4, border: "1px solid #ccc" }}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </div>
        {mode === "register" && (
          <div style={{ marginBottom: 16, display: "flex", gap: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              BG
              <input type="color" value={regBg} onChange={e => setRegBg(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              Text
              <input type="color" value={regText} onChange={e => setRegText(e.target.value)} />
            </label>
          </div>
        )}
        {error && <div style={{ color: "#c00", marginBottom: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 4,
            background: buttonBg,
            color: buttonText,
            border: "none",
            fontWeight: 600,
            fontSize: 16,
            marginBottom: 8,
            cursor: loading ? "not-allowed" : "pointer",
            transition: 'background 0.2s',
          }}
        >
          {loading ? "Please wait..." : mode === "login" ? "Login" : "Register"}
        </button>
        <div style={{ marginTop: 16, textAlign: "center" }}>
          {mode === "login" ? (
            <span>
              New here?{' '}
              <button type="button" style={{ color: textColor, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }} onClick={() => setMode("register")}>Register</button>
            </span>
          ) : (
            <span>
              Already have an account?{' '}
              <button type="button" style={{ color: textColor, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }} onClick={() => setMode("login")}>Login</button>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
