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
  // Ban user state
  const [banUser, setBanUser] = useState("");
  const [banStatus, setBanStatus] = useState("");
  const [banConfirm, setBanConfirm] = useState(false);
  // Unban user state
  const [unbanUser, setUnbanUser] = useState("");
  const [unbanStatus, setUnbanStatus] = useState("");

  // Seed Drive Books state
  const [seedStatus, setSeedStatus] = useState("");
  const [seedLoading, setSeedLoading] = useState(false);

  // Add these states near the top
  const [newsletterSubject, setNewsletterSubject] = useState("");
  const [newsletterMsg, setNewsletterMsg] = useState("");
  const [newsletterStatus, setNewsletterStatus] = useState("");
  const [newsletterSending, setNewsletterSending] = useState(false);


  async function handleSeedDriveBooks() {
    setSeedLoading(true);
    setSeedStatus("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/seed-drive-books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        setSeedStatus(`Seeded: ${data.added_count} new, ${data.updated_count} updated, ${data.external_id_updates} external IDs. Message: ${data.message}`);
      } else {
        setSeedStatus(data.message || "Failed to seed books.");
      }
    } catch (e) {
      setSeedStatus("Error calling seed-drive-books endpoint: ", e);
    }
    setSeedLoading(false);
  }

  // Add this function
async function handleSendNewsletter(e) {
  e.preventDefault();
  setNewsletterSending(true);
  setNewsletterStatus("");
  try {
    const res = await fetch(`${API_BASE_URL}/api/admin/send-newsletter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminUsername: user.username,
        subject: newsletterSubject,
        message: newsletterMsg
      })
    });
    const data = await res.json();
    setNewsletterStatus(data.success ? "Newsletter sent successfully." : data.message || "Failed to send newsletter.");
    setNewsletterSubject("");
    setNewsletterMsg("");
  } catch {
    setNewsletterStatus("Failed to send newsletter.");
  }
  setNewsletterSending(false);
}

  const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor;
  const containerBg = stepColor(cssBg, theme, 1);
  const buttonBg = stepColor(backgroundColor, theme, 2);

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
    const endpoint = adminAction === "give"
      ? `${API_BASE_URL}/api/admin/make-admin`
      : `${API_BASE_URL}/api/admin/remove-admin`;
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminUsername: user.username, targetUsername: adminUser })
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
      {/* Manual Seed Drive Books Button */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={handleSeedDriveBooks}
          disabled={seedLoading}
          style={{ background: buttonBg, color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: seedLoading ? 0.6 : 1 }}
        >
          {seedLoading ? "Seeding..." : "Seed Google Drive Books"}
        </button>
        {seedStatus && <div style={{ color: seedStatus.includes("Seeded") ? 'var(--success-text, #080)' : 'var(--error-text, #c00)', marginTop: 8 }}>{seedStatus}</div>}
      </div>
      <h3 style={{ color: textColor }}>Admin Tools</h3>
      {/* Emergency Email Form */}
      <form onSubmit={handleSendEmail} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
      <label style={{ color: textColor, fontWeight: 500, marginBottom: 2 }}>
          Emergency Email Recipient:
          <select
            value={recipientType}
            onChange={e => setRecipientType(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120 }}
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
              style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120 }}
              required
            />
          </label>
        )}
        <label style={{ color: textColor }}>
          Message:
          <textarea
            value={emailMsg}
            onChange={e => setEmailMsg(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120, minHeight: 60 }}
            required
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          style={{ background: buttonBg, color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Sending..." : "Send Emergency Email"}
        </button>
        {emailStatus && <div style={{ color: emailStatus.includes("success") ? 'var(--success-text, #080)' : 'var(--error-text, #c00)', marginTop: 8 }}>{emailStatus}</div>}
      </form>
      {/* Newsletter Form */}
      <h3 style={{ color: textColor, marginTop: 32 }}>Send Newsletter</h3>
      <form onSubmit={handleSendNewsletter} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
        <label style={{ color: textColor }}>
          Subject:
          <input
            type="text"
            value={newsletterSubject}
            onChange={e => setNewsletterSubject(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120 }}
            required
          />
        </label>
        <label style={{ color: textColor }}>
          Message:
          <textarea
            value={newsletterMsg}
            onChange={e => setNewsletterMsg(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120, minHeight: 60 }}
            required
          />
        </label>
        <button
          type="submit"
          disabled={newsletterSending}
          style={{ background: buttonBg, color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: newsletterSending ? 0.6 : 1 }}
        >
          {newsletterSending ? "Sending..." : "Send Newsletter"}
        </button>
        {newsletterStatus && <div style={{ color: newsletterStatus.includes("success") ? 'var(--success-text, #080)' : 'var(--error-text, #c00)', marginTop: 8 }}>{newsletterStatus}</div>}
      </form>
      {/* Admin Rights Form */}
      <form onSubmit={handleAdminAction} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
      <label style={{ color: textColor }}>
          Username:
          <input
            type="text"
            value={adminUser}
            onChange={e => setAdminUser(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120 }}
            required
          />
        </label>
        <label style={{ color: textColor }}>
          <select
            value={adminAction}
            onChange={e => setAdminAction(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120 }}
          >
            <option value="give">Grant Admin Rights</option>
            <option value="remove">Revoke Admin Rights</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={saving}
          style={{ background: buttonBg, color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? (adminAction === "give" ? "Granting..." : "Revoking...") : (adminAction === "give" ? "Grant Admin" : "Revoke Admin")}
        </button>
        {adminStatus && <div style={{ color: adminStatus.includes("granted") ? 'var(--success-text, #080)' : adminStatus.includes("revoked") ? 'var(--error-text, #c00)' : 'var(--error-text, #c00)', marginTop: 8 }}>{adminStatus}</div>}
      </form>
      {/* Ban User Form */}
      <form onSubmit={e => { e.preventDefault(); setBanConfirm(true); }} style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
      <label style={{ color: textColor }}>
          Username to Ban:
          <input
            type="text"
            value={banUser}
            onChange={e => setBanUser(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120 }}
            required
          />
        </label>
        <button
          type="submit"
          disabled={saving || !banUser}
          style={{ background: buttonBg, color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Processing..." : "Ban User"}
        </button>
        {banStatus && <div style={{ color: banStatus.includes("banned") ? 'var(--success-text, #080)' : 'var(--error-text, #c00)', marginTop: 8 }}>{banStatus}</div>}
      </form>

      {/* Unban User Form */}
      <form onSubmit={async e => {
        e.preventDefault();
        setSaving(true);
        setUnbanStatus("");
        try {
          const res = await fetch(`${API_BASE_URL}/api/admin/unban-user`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminUsername: user.username, targetUsername: unbanUser })
          });
          const data = await res.json();
          setUnbanStatus(data.message || (data.success ? `User ${unbanUser} unbanned.` : "Failed to unban user."));
          setUnbanUser("");
        } catch {
          setUnbanStatus("Failed to unban user.");
        }
        setSaving(false);
      }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ color: textColor }}>
          Username to Unban:
          <input
            type="text"
            value={unbanUser}
            onChange={e => setUnbanUser(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 4, border: "1px solid var(--input-border, #ccc)", minWidth: 120 }}
            required
          />
        </label>
        <button
          type="submit"
          disabled={saving || !unbanUser}
          style={{ background: buttonBg, color: textColor, border: "none", borderRadius: 4, padding: "8px 16px", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Processing..." : "Unban User"}
        </button>
        {unbanStatus && <div style={{ color: unbanStatus.includes("unbanned") ? "#080" : "#c00", marginTop: 8 }}>{unbanStatus}</div>}
      </form>
      {/* Confirmation Dialog */}
      {banConfirm && (
        <div style={{ position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", background: "var(--modal-bg, #0008)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--modal-content-bg, #fff)", color: "var(--modal-content-text, #222)", borderRadius: 8, padding: "24px 32px", boxShadow: "0 4px 24px rgba(0,0,0,0.18)", minWidth: 320 }}>
            <div style={{ marginBottom: 18, fontSize: 17 }}>
              Are you sure you want to <b style={{ color: 'var(--error-text, #c00)' }}>ban</b> user <b>{banUser}</b>?
            </div>
            <button
              style={{ background: 'var(--error-text, #c00)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 600, marginRight: 12, cursor: 'pointer' }}
              onClick={async () => {
                setSaving(true);
                setBanStatus("");
                setBanConfirm(false);
                try {
                  const res = await fetch(`${API_BASE_URL}/api/admin/ban-user`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ adminUsername: user.username, targetUsername: banUser })
                  });
                  const data = await res.json();
                  setBanStatus(data.message || (data.success ? `User ${banUser} banned.` : "Failed to ban user."));
                  setBanUser("");
                } catch {
                  setBanStatus("Failed to ban user.");
                }
                setSaving(false);
              }}
            >Yes, Ban</button>
            <button
              style={{ background: 'var(--modal-cancel-bg, #eee)', color: 'var(--modal-cancel-text, #222)', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}
              onClick={() => setBanConfirm(false)}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
});

export default AdminTabContent;
