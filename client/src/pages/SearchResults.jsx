import { stepColor } from "../utils/colorUtils";
import { waitForServerHealth } from "../utils/serviceHealth";
import React, { useEffect, useState, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import AdBanner300x250 from "../components/AdBanner300x250";
import AdNativeBanner from "../components/AdNativeBanner";

// Small inline sponsored result that visually matches search results but is clearly labeled
function SponsoredResult({ containerBg, containerText }) {
  const [adMetadata, setAdMetadata] = useState(null);
  const [adBlocked, setAdBlocked] = useState(false);

  const sponsorStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    marginBottom: 18,
    background: containerBg,
    color: containerText,
    borderRadius: 8,
    padding: '12px 18px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.03)',
    border: '2px solid rgba(200,160,0,0.06)'
  };

  const badgeStyle = {
    fontSize: 12,
    padding: '4px 8px',
    borderRadius: 12,
    background: '#fff8e6',
    color: '#b27700',
    fontWeight: 700,
    marginRight: 8,
    border: '1px solid rgba(180,120,0,0.08)'
  };

  const handleClick = () => {
    // Prefer ad-provided click URL when available
    const url = (adMetadata && (adMetadata.clickUrl || adMetadata.url)) || 'https://example.com';
    // Analytics hook could be added here before navigation
    window.open(url, '_blank', 'noopener');
  };

  // If the ad provider blocked the creative, remove the sponsored card entirely
  if (adBlocked) return null;

  return (
    <li style={sponsorStyle} role="article" aria-label="Sponsored result">
      <div style={{ flex: 1 }}>
        {adMetadata ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={badgeStyle}>Sponsored</span>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{adMetadata.title || 'Recommended for you — Sponsored'}</div>
            </div>
            {adMetadata.subtitle && (
              <div style={{ fontSize: 14, color: '#666', marginTop: 6 }}>{adMetadata.subtitle}</div>
            )}
          </>
        ) : (
          // Minimal presentation when metadata isn't available: keep the badge and let the native creative fill the slot
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={badgeStyle}>Sponsored</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        {/* Use the native ad script inside the sponsored slot; it will hide itself if blocked. */}
        <div style={{ width: 300, minHeight: 50 }}>
          <AdNativeBanner
            style={{ width: 300, minHeight: 50, borderRadius: 8, background: containerBg }}
            onAdLoaded={(meta) => {
              if (meta) setAdMetadata(meta);
            }}
            onAdBlocked={() => setAdBlocked(true)}
          />
        </div>
        <button onClick={handleClick} style={{ background: 'var(--accent-color)', color: 'var(--container-bg)', border: 'none', padding: '6px 14px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
          {adMetadata && adMetadata.title ? 'Learn' : 'Learn'}
        </button>
      </div>
    </li>
  );
}

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

export default function SearchResults() {
  const location = useLocation();
  const navigate = useNavigate();
  // Use context only for theme and user, not for colors
  const { theme, user, backgroundColor } = useContext(ThemeContext);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("az"); // az, za, newest, oldest

  // Get query from URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setQuery(params.get("query") || "");
  }, [location.search]);


  // Fetch all books metadata from DB, filter by query, then fetch details for matching IDs
  useEffect(() => {
    async function fetchResultsAndBookmarks() {
      if (!query) return;
      setLoading(true);
      // Step 1: Get all book metadata (just IDs/titles) from DB
      await waitForServerHealth();
      try {
        const res = await fetch(`${API_BASE_URL}/api/all-books`);
        const data = await res.json();
        let filtered = [];
        if (Array.isArray(data.books)) {
          // Partial and prefix match on title OR external_story_id
          const q = query.toLowerCase();
          filtered = data.books.filter(pdf => {
            const titleMatch = pdf.title && (
              pdf.title.toLowerCase().includes(q) ||
              pdf.title.toLowerCase().startsWith(q)
            );
            const extIdMatch = pdf.external_story_id && (
              pdf.external_story_id.toLowerCase().includes(q) ||
              pdf.external_story_id.toLowerCase().startsWith(q)
            );
            return titleMatch || extIdMatch;
          });
        }
        // Step 2: Fetch full metadata for matching IDs
        if (filtered.length > 0) {
          const ids = filtered.map(b => b.drive_id || b.id).filter(Boolean);
          await waitForServerHealth();
          try {
            const res2 = await fetch(`${API_BASE_URL}/api/books?ids=${ids.join(',')}`);
            const data2 = await res2.json();
            if (Array.isArray(data2.books)) {
              setResults(data2.books);
            } else {
              setResults([]);
            }
            setLoading(false);
          } catch {
            setResults([]);
            setLoading(false);
          }
        } else {
          setResults([]);
          setLoading(false);
        }
      } catch {
        setResults([]);
        setLoading(false);
      }
      // Fetch bookmarks if user is logged in
      if (user && user.username) {
        await waitForServerHealth();
        try {
          const resBm = await fetch(`${API_BASE_URL}/api/get-bookmarks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username })
          });
          const dataBm = await resBm.json();
          if (dataBm.success && Array.isArray(dataBm.bookmarks)) {
            setBookmarks(dataBm.bookmarks.map(bm => bm.id));
          }
        } catch {
          setBookmarks([]);
        }
      } else {
        setBookmarks([]);
      }
    }
    fetchResultsAndBookmarks();
  }, [query, user]);

  // Sorting logic
  function getLastUpdated(pdf) {
    return (
      pdf.modifiedTime ||
      pdf.createdTime ||
      pdf.created_at ||
      null
    );
  }

  // Memoize sortedResults to avoid new array on every render
  const sortedResults = React.useMemo(() => {
    return [...results].sort((a, b) => {
      if (sort === "az") {
        const titleA = a.title || "";
        const titleB = b.title || "";
        return titleA.localeCompare(titleB);
      }
      if (sort === "za") {
        const titleA = a.title || "";
        const titleB = b.title || "";
        return titleB.localeCompare(titleA);
      }
      if (sort === "newest" || sort === "oldest") {
        const dateA = getLastUpdated(a) ? new Date(getLastUpdated(a)) : new Date(0);
        const dateB = getLastUpdated(b) ? new Date(getLastUpdated(b)) : new Date(0);
        return sort === "newest" ? dateB - dateA : dateA - dateB;
      }
      return 0;
    });
  }, [results, sort]);

  // Cover logic removed

  // Use stepColor for container background and CSS variable for text
  const containerBg = stepColor(backgroundColor, theme, 1);
  const listItemBg = stepColor(backgroundColor, theme, 2);
  const containerText = "var(--text-color)";

  return (
    <div
      className={`search-results-page ${theme}-mode`}
      style={{ background: stepColor(backgroundColor, theme, 0), color: "var(--text-color)", minHeight: '100vh', padding: '32px 0', display: 'flex', flexDirection: 'column' }}
    >
      {/* Regular banner ad at the very top */}
      <div style={{ display: "flex", justifyContent: "center", margin: "32px 0" }}>
        <AdBanner300x250 />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ maxWidth: 900, margin: '0 auto', background: containerBg, color: containerText, borderRadius: 10, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <h2 style={{ marginBottom: 18 }}>Search Results for "{query}"</h2>
          <div style={{ marginBottom: 18, display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>Sort by:</span>
            <select value={sort} onChange={e => setSort(e.target.value)} style={{ fontSize: 16, borderRadius: 4, padding: '2px 8px' }}>
              <option value="az">A-Z</option>
              <option value="za">Z-A</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </div>
          {loading ? (
            <div>Loading...</div>
          ) : sortedResults.length === 0 ? (
            <div>No books found matching your search.</div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {(() => {
                const items = [];
                const insertIndex = Math.min(2, sortedResults.length); // after 2nd item
                for (let i = 0; i < sortedResults.length; i++) {
                  // Insert sponsored result at the chosen index
                  if (i === insertIndex) {
                    items.push(
                      <SponsoredResult key="sponsored-1" containerBg={listItemBg} containerText={containerText} />
                    );
                  }
                  const pdf = sortedResults[i];
                  const bookId = pdf.drive_id || pdf.id;
                  // Determine votes count from possible backend shapes. Fallback to 0.
                  const voteCount = (pdf.total_votes ?? pdf.vote_count ?? (pdf.votes ? (Array.isArray(pdf.votes) ? pdf.votes.length : null) : null) ?? 0);
                  if (!bookId) {
                    console.warn('[SearchResults] Rendering: invalid book id', pdf);
                    items.push(
                      <li key={Math.random()} style={{ color: '#c00', fontSize: 14, marginBottom: 18 }}>
                        [No valid book id]
                      </li>
                    );
                    continue;
                  }
                  items.push(
                    <li key={bookId || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18, background: listItemBg, color: containerText, borderRadius: 8, padding: '12px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 18 }}>{pdf.title}</div>
                        <div style={{ fontSize: 14, color: '#888' }}>
                          Last updated: {
                            pdf.modifiedTime
                              ? new Date(pdf.modifiedTime).toLocaleString()
                              : pdf.createdTime
                                ? new Date(pdf.createdTime).toLocaleString()
                                : pdf.created_at
                                  ? new Date(pdf.created_at).toLocaleString()
                                  : 'Unknown'
                          }
                        </div>
                      </div>
                      {bookmarks.includes(bookId) && (
                        <span style={{ color: containerText, fontWeight: 600, fontSize: 15, marginRight: 8 }}>★ Favorited</span>
                      )}
                      {/* Vote indicator: show star + count, even when 0 */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: 12 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#b27700' }}>★ {voteCount}</div>
                        <div style={{ fontSize: 12, color: '#888' }}>{voteCount} vote{voteCount === 1 ? '' : 's'}</div>
                      </div>
                      <button
                        style={{ background: stepColor(backgroundColor, theme, 0), color: containerText, border: '1px solid var(--accent-color)', borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                        onClick={() => navigate(`/read/${pdf.id}`)}
                      >Read</button>
                    </li>
                  );
                }
                // If insert index is at end, ensure sponsored is appended
                if (insertIndex >= sortedResults.length) {
                  items.push(<SponsoredResult key="sponsored-1" containerBg={listItemBg} containerText={containerText} />);
                }
                return items;
              })()}
            </ul>
          )}
        </div>
      </div>
      {/* Native banner ad at the very bottom */}
      <div style={{ display: "flex", justifyContent: "center", margin: "32px 0" }}>
        <AdNativeBanner style={{ width: 300, minHeight: 50, borderRadius: 8, background: containerBg }} />
      </div>
    </div>
  );
}
