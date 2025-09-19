import { stepColor } from "../utils/colorUtils";
import { waitForServerHealth } from "../utils/serviceHealth";

// --- Unified cover cache logic from LandingPage.jsx ---
function useCachedCovers(pdfs) {
  const [covers, setCovers] = React.useState({});
  const [loadingCovers, setLoadingCovers] = React.useState({});
  const { user } = React.useContext(ThemeContext);
  React.useEffect(() => {
    let isMounted = true;
    const newCovers = {};
    const newLoading = {};
    pdfs.forEach(pdf => {
      const bookId = pdf && (pdf.drive_id || pdf.id);
      if (!bookId) return;
      // Use public cover_url from API response
      const coverUrl = pdf.cover_url || '/no-cover.png';
      newCovers[bookId] = coverUrl;
      newLoading[bookId] = false;
    });
    if (isMounted) setCovers(newCovers);
    if (isMounted) setLoadingCovers(newLoading);
    return () => { isMounted = false; };
  }, [pdfs, user]);
  return { covers, loadingCovers };
}
import React, { useEffect, useState, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;
function setCoverInCache(bookId, url) {
  try {
    const cache = JSON.parse(localStorage.getItem('swc_cover_cache') || '{}');
    if (url === '/no-cover.png') {
      cache[bookId] = { url, ts: Date.now() };
    } else {
      cache[bookId] = { url };
    }
    localStorage.setItem('swc_cover_cache', JSON.stringify(cache));
  } catch {
    null;
  }
}

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
          const ids = filtered.map(b => b.id).filter(Boolean);
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
      if (sort === "az") return a.title.localeCompare(b.title);
      if (sort === "za") return b.title.localeCompare(a.title);
      if (sort === "newest" || sort === "oldest") {
        const dateA = getLastUpdated(a) ? new Date(getLastUpdated(a)) : new Date(0);
        const dateB = getLastUpdated(b) ? new Date(getLastUpdated(b)) : new Date(0);
        return sort === "newest" ? dateB - dateA : dateA - dateB;
      }
      return 0;
    });
  }, [results, sort]);

  // Use unified cover cache logic
  const { covers, loadingCovers } = useCachedCovers(sortedResults);

  // Use stepColor for container background and CSS variable for text
  const containerBg = stepColor(backgroundColor, theme, 1);
  const listItemBg = stepColor(backgroundColor, theme, 2);
  const containerText = "var(--text-color)";

  return (
    <div
      className={`search-results-page ${theme}-mode`}
      style={{ background: stepColor(backgroundColor, theme, 0), color: "var(--text-color)", minHeight: '100vh', padding: '32px 0' }}
    >
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
            {sortedResults.map(pdf => {
              const bookId = pdf.drive_id || pdf.id;
              if (!bookId) {
                console.warn('[SearchResults] Rendering: invalid book id', pdf);
                return (
                  <li key={Math.random()} style={{ color: '#c00', fontSize: 14, marginBottom: 18 }}>
                    [No valid book id]
                  </li>
                );
              }
              const coverUrl = covers[bookId] || '/no-cover.png';
              const isLoading = loadingCovers[bookId];
              return (
                <li key={bookId || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18, background: listItemBg, color: containerText, borderRadius: 8, padding: '12px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  {/* Cover image or placeholder */}
                  <div style={{ width: 60, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isLoading
                      ? (
                        <img
                          src="/loading-cover.svg"
                          alt="Loading Cover"
                          style={{ width: 60, height: 90, objectFit: 'cover', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                        />
                      )
                      : coverUrl === '/no-cover.png'
                        ? (
                          <img
                            src="/no-cover.svg"
                            alt="No Cover"
                            style={{ width: 60, height: 90, objectFit: 'cover', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                          />
                        )
                        : (
                          <img
                            src={coverUrl}
                            alt={pdf.title}
                            style={{ width: 60, height: 90, objectFit: 'cover', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                            onError={e => {
                              if (e.target.src !== '/no-cover.svg') {
                                setCoverInCache(bookId, '/no-cover.png');
                                e.target.src = '/no-cover.svg';
                              }
                            }}
                          />
                        )
                    }
                  </div>
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
                  {bookmarks.includes(pdf.id) && (
                    <span style={{ color: containerText, fontWeight: 600, fontSize: 15, marginRight: 8 }}>★ Favorited</span>
                  )}
                  <button
                    style={{ background: stepColor(backgroundColor, theme, 0), color: containerText, border: '1px solid var(--accent-color)', borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => navigate(`/read/${pdf.id}`)}
                  >Read</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
