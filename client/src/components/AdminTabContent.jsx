import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor } from "../utils/colorUtils";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

const AdminTabContent = React.memo(function AdminTabContent({ user }) {
  const { backgroundColor, textColor, theme } = useContext(ThemeContext);
  // Emergency email state
  const [recipientType, setRecipientType] = useState("all");
  const [recipientValue, setRecipientValue] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [adminUser, setAdminUser] = useState("");
  const [adminAction, setAdminAction] = useState("give");
  const [adminStatus, setAdminStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const containerBg = stepColor(backgroundColor, theme, 1);

  function handleSendEmail(e) {
    e.preventDefault();
    setSaving(true);
    setEmailStatus("");
    // Determine recipient value
    let recipient = "all";
    if (recipientType === "username" || recipientType === "email") {
      recipient = recipientValue.trim();
    }
    fetch(`${API_BASE_URL}/api/admin/send-emergency-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminUsername: user.username, subject: "Emergency Message", message: emailMsg, recipient })
    })
      .then(res => res.json())
      .then(data => {
        setEmailStatus(data.success ? "Email sent successfully." : data.message || "Failed to send email.");
        setRecipientValue("");
        setEmailMsg("");
      })
      .finally(() => setSaving(false));
  }

  function handleAdminAction(e) {
    e.preventDefault();
    setSaving(true);
    setAdminStatus("");
    fetch(`${API_BASE_URL}/api/admin-set-role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin: user.username, target: adminUser, action: adminAction })
    })
      .then(res => res.json())
      .then(data => {
        setAdminStatus(data.success ? `Admin rights ${adminAction === "give" ? "granted" : "revoked"} for ${adminUser}.` : data.error || "Failed to update admin rights.");
        setAdminUser("");
      })
      .finally(() => setSaving(false));
  }

  return (
    <div style={{ width: 400, maxWidth: "95vw", marginBottom: 32, background: containerBg, borderRadius: 8, padding: "18px 16px" }}>
      <h3 style={{ color: textColor }}>Admin Tools</h3>
      <form onSubmit={handleSendEmail} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
        <label style={{ color: textColor, fontWeight: 500, marginBottom: 2 }}>
          Emergency Email Recipient:
          <select
            value={recipientType}
            onChange={e => setRecipientType(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 120 }}
          >
            <option value="all">All users</option>
            <option value="username">Username</option>
            <option value="email">Email</option>
          </select>
        </label>
        {(recipientType === "username" || recipientType === "email") && (
          <label style={{ color: textColor }}>
            {recipientType === "username" ? "Username:" : "Email:"}
            <input
              type={recipientType === "email" ? "email" : "text"}
              value={recipientValue}
              onChange={e => setRecipientValue(e.target.value)}
              style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 120 }}
              required
            />
          </label>
        )}
        <label style={{ color: textColor }}>
          Message:
          <textarea
            value={emailMsg}
            onChange={e => setEmailMsg(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 120, minHeight: 60 }}
            required
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          style={{ background: stepColor(containerBg, "dark", 1, 1), color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Sending..." : "Send Emergency Email"}
        </button>
        {emailStatus && <div style={{ color: emailStatus.includes("success") ? "#080" : "#c00", marginTop: 8 }}>{emailStatus}</div>}
      </form>
      <form onSubmit={handleAdminAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ color: textColor }}>
          Username:
          <input
            type="text"
            value={adminUser}
            onChange={e => setAdminUser(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 120 }}
            required
          />
        </label>
        <label style={{ color: textColor }}>
          <select
            value={adminAction}
            onChange={e => setAdminAction(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 120 }}
          >
            <option value="give">Grant Admin Rights</option>
            <option value="remove">Revoke Admin Rights</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={saving}
          style={{ background: stepColor(containerBg, "dark", 1, 1), color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? (adminAction === "give" ? "Granting..." : "Revoking...") : (adminAction === "give" ? "Grant Admin" : "Revoke Admin")}
        </button>
        {adminStatus && <div style={{ color: adminStatus.includes("granted") ? "#080" : adminStatus.includes("revoked") ? "#c00" : "#c00", marginTop: 8 }}>{adminStatus}</div>}
      </form>
    </div>
  );
});

export default AdminTabContent;
