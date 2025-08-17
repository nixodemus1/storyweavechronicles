import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor } from "../utils/colorUtils";
import { useNavigate } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

const SecurityTabContent = React.memo(function SecurityTabContent({ user, setUser }) {
  const { backgroundColor, textColor, theme } = useContext(ThemeContext);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();

  const containerBg = stepColor(backgroundColor, theme, 1);

  function handlePasswordChange(e) {
    setPassword(e.target.value);
    setError("");
    setSuccess("");
  }
  function handleConfirmChange(e) {
    setConfirm(e.target.value);
    setError("");
    setSuccess("");
  }
  function handleUpdatePassword(e) {
    e.preventDefault();
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    fetch(`${API_BASE_URL}/api/update-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setSuccess("Password updated successfully.");
          setPassword("");
          setConfirm("");
        } else {
          setError(data.error || "Failed to update password.");
        }
      })
      .finally(() => setSaving(false));
  }

  // Account deletion with password confirmation
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  function handleDeleteAccount(e) {
    e.preventDefault();
    if (!window.confirm("Are you sure you want to delete your account? This cannot be undone.")) return;
    if (!deletePassword || deletePassword.length < 6) {
      setDeleteError("Please enter your password to confirm deletion.");
      return;
    }
    setSaving(true);
    setDeleteError("");
    fetch(`${API_BASE_URL}/api/delete-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: deletePassword })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setUser(null);
          navigate("/");
        } else {
          setDeleteError(data.message || "Failed to delete account.");
        }
      })
      .finally(() => setSaving(false));
  }

  return (
    <div style={{ width: 400, maxWidth: "95vw", marginBottom: 32, background: containerBg, borderRadius: 8, padding: "18px 16px" }}>
      <h3 style={{ color: textColor }}>Security Settings</h3>
      <form onSubmit={handleUpdatePassword} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <label style={{ color: textColor }}>
          New Password:
          <input
            type="password"
            value={password}
            onChange={handlePasswordChange}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 120 }}
            autoComplete="new-password"
          />
        </label>
        <label style={{ color: textColor }}>
          Confirm Password:
          <input
            type="password"
            value={confirm}
            onChange={handleConfirmChange}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 120 }}
            autoComplete="new-password"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          style={{ background: stepColor(containerBg, "dark", 1, 1), color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : "Update Password"}
        </button>
      </form>
      <form onSubmit={handleDeleteAccount} style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ color: textColor }}>
          Confirm Password to Delete Account:
          <input
            type="password"
            value={deletePassword}
            onChange={e => setDeletePassword(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 120 }}
            autoComplete="current-password"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          style={{ background: "#c00", color: "#fff", border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          Delete Account
        </button>
        {deleteError && <div style={{ color: "#c00", marginTop: 8 }}>{deleteError}</div>}
      </form>
      {error && <div style={{ color: "#c00", marginTop: 12 }}>{error}</div>}
      {success && <div style={{ color: "#080", marginTop: 12 }}>{success}</div>}
    </div>
  );
});

export default SecurityTabContent;
