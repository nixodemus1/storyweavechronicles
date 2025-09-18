// Utility: wait for server health before DB calls
export async function waitForServerHealth() {
  const baseUrl = import.meta.env.VITE_HOST_URL || "";
  const retryMs = Number(import.meta.env.REACT_APP_SERVER_HEALTH_RETRY_MS) || 2000;
  while (true) {
    try {
      const res = await fetch(baseUrl + "/api/server-health");
      const data = await res.json();
      if (data.success) return true;
    } catch (err) {
      console.error("[waitForServerHealth] Error checking server health:", err);
    }
    await new Promise(resolve => setTimeout(resolve, retryMs));
  }
}