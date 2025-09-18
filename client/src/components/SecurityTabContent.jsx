import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor } from "../utils/colorUtils";
import { useNavigate } from "react-router-dom";
import { waitForServerHealth } from "../utils/serviceHealth";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

const SecurityTabContent = React.memo(function SecurityTabContent({ user, setUser }) {
  const { backgroundColor, textColor, theme } = useContext(ThemeContext);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();

  // Secondary email management
  const [secondaryEmails, setSecondaryEmails] = useState(user?.secondaryEmails || []);
  const [newSecondaryEmail, setNewSecondaryEmail] = useState("");
  const [secondaryEmailError, setSecondaryEmailError] = useState("");
  const [secondaryEmailSuccess, setSecondaryEmailSuccess] = useState("");

  React.useEffect(() => {
    setSecondaryEmails(user?.secondaryEmails || []);
  }, [user?.secondaryEmails]);

  function handleAddSecondaryEmail(e) {
    e.preventDefault();
    setSecondaryEmailError("");
    setSecondaryEmailSuccess("");
    if (!newSecondaryEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newSecondaryEmail)) {
      setSecondaryEmailError("Please enter a valid email address.");
      return;
    }
    setSaving(true);
    (async () => {
      await waitForServerHealth();
      fetch(`${API_BASE_URL}/api/add-secondary-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, email: newSecondaryEmail })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setSecondaryEmails(data.secondaryEmails);
            setSecondaryEmailSuccess("Secondary email added.");
            setNewSecondaryEmail("");
            if (setUser) setUser(u => u ? { ...u, secondaryEmails: data.secondaryEmails } : u);
          } else {
            setSecondaryEmailError(data.message || "Failed to add secondary email.");
          }
        })
        .finally(() => setSaving(false));
    })();
  }

  function handleRemoveSecondaryEmail(email) {
    setSecondaryEmailError("");
    setSecondaryEmailSuccess("");
    setSaving(true);
    (async () => {
      await waitForServerHealth();
      fetch(`${API_BASE_URL}/api/remove-secondary-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, email })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setSecondaryEmails(data.secondaryEmails);
            setSecondaryEmailSuccess("Secondary email removed.");
            if (setUser) setUser(u => u ? { ...u, secondaryEmails: data.secondaryEmails } : u);
          } else {
            setSecondaryEmailError(data.message || "Failed to remove secondary email.");
          }
        })
        .finally(() => setSaving(false));
    })();
  }

  const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor;
  const containerBg = stepColor(cssBg, theme, 1);

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
    (async () => {
      await waitForServerHealth();
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
    })();
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
    (async () => {
      await waitForServerHealth();
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
    })();
  }

  return (
  <div style={{ width: 400, maxWidth: "95vw", marginBottom: 32, background: containerBg, borderRadius: 8, padding: "18px 16px" }}>
  <h3 style={{ color: 'var(--text-color)' }}>Security Settings</h3>
      {/* Secondary Email Management */}
      <div style={{ marginBottom: 24 }}>
        <h4>Secondary Emails</h4>
        {Array.isArray(secondaryEmails) && secondaryEmails.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: 10 }}>
            {secondaryEmails.map(email => (
              <li key={email} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 15 }}>{email}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveSecondaryEmail(email)}
                  style={{ background: stepColor(containerBg, theme, 1, -1), color: '#c00', border: 'none', borderRadius: 4, padding: '4px 10px', fontWeight: 600, cursor: 'pointer' }}
                  disabled={saving}
                  title="Remove secondary email"
                >Remove</button>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ color: '#888', marginBottom: 10 }}>No secondary emails added.</div>
        )}
        <form onSubmit={handleAddSecondaryEmail} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="email"
            value={newSecondaryEmail}
            onChange={e => setNewSecondaryEmail(e.target.value)}
            placeholder="Add secondary email"
            style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', minWidth: 180 }}
            disabled={saving}
          />
          <button
            type="submit"
            disabled={saving || !newSecondaryEmail}
            style={{ background: stepColor(containerBg, theme, 1, -1), color: 'var(--text-color)', border: 'none', borderRadius: 4, padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}
          >Add</button>
        </form>
        {secondaryEmailError && <div style={{ color: '#c00', marginTop: 8 }}>{secondaryEmailError}</div>}
        {secondaryEmailSuccess && <div style={{ color: '#080', marginTop: 8 }}>{secondaryEmailSuccess}</div>}
      </div>
      {/* Password Change */}
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
  <label style={{ color: 'var(--text-color)' }}>
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
          style={{ background: stepColor(containerBg, theme, 1, -1), color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : "Update Password"}
        </button>
      </form>
      {/* Account Deletion */}
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
