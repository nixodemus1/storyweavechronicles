import React, { useEffect, useState, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import { stepColor, getLuminance } from "../utils/colorUtils";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;
function getCoverFromCache(bookId) {
  try {
    const cache = JSON.parse(localStorage.getItem('swc_cover_cache') || '{}');
  // Only return /no-cover.png if explicitly cached, otherwise return API URL
  if (cache[bookId] === '/no-cover.png') return '/no-cover.png';
  return cache[bookId] || `${API_BASE_URL}/pdf-cover/${bookId}`;
  } catch {
    return `${API_BASE_URL}/pdf-cover/${bookId}`;
  }
}
function setCoverInCache(bookId, url) {
  try {
    const cache = JSON.parse(localStorage.getItem('swc_cover_cache') || '{}');
    cache[bookId] = url;
    localStorage.setItem('swc_cover_cache', JSON.stringify(cache));
  } catch {
    null;
  }
}

export default function SearchResults() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, backgroundColor, textColor, user } = useContext(ThemeContext);
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
    if (!query) return;
    setLoading(true);
    // Step 1: Get all book metadata (just IDs/titles) from DB
    fetch(`${API_BASE_URL}/api/all-books`)
      .then(res => res.json())
      .then(data => {
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
          fetch(`${API_BASE_URL}/api/books?ids=${ids.join(',')}`)
            .then(res2 => res2.json())
            .then(data2 => {
              if (Array.isArray(data2.books)) {
                setResults(data2.books);
              } else {
                setResults([]);
              }
              setLoading(false);
            })
            .catch(() => {
              setResults([]);
              setLoading(false);
            });
        } else {
          setResults([]);
          setLoading(false);
        }
      })
      .catch(() => {
        setResults([]);
        setLoading(false);
      });
    // Fetch bookmarks if user is logged in
    if (user && user.username) {
      fetch(`${API_BASE_URL}/api/get-bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.bookmarks)) {
            setBookmarks(data.bookmarks.map(bm => bm.id));
          }
        });
    } else {
      setBookmarks([]);
    }
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
  const sortedResults = [...results].sort((a, b) => {
    if (sort === "az") return a.title.localeCompare(b.title);
    if (sort === "za") return b.title.localeCompare(a.title);
    if (sort === "newest" || sort === "oldest") {
      const dateA = getLastUpdated(a) ? new Date(getLastUpdated(a)) : new Date(0);
      const dateB = getLastUpdated(b) ? new Date(getLastUpdated(b)) : new Date(0);
      return sort === "newest" ? dateB - dateA : dateA - dateB;
    }
    return 0;
  });

  // Preload covers and cache them in localStorage, but skip if cached is '/no-cover.png'
  useEffect(() => {
    sortedResults.forEach(pdf => {
      if (!pdf.id) {
        console.warn('[SearchResults] Skipping cover preload: invalid book id', pdf);
        return;
      }
      const cached = getCoverFromCache(pdf.id);
      // Only preload if not cached or is direct API url, but NOT if cached is '/no-cover.png'
      if (!cached || (cached.startsWith(API_BASE_URL) && cached !== '/no-cover.png')) {
        if (cached !== '/no-cover.png') {
          const url = `${API_BASE_URL}/pdf-cover/${pdf.id}`;
          const img = new window.Image();
          img.onload = () => setCoverInCache(pdf.id, url);
          img.onerror = () => setCoverInCache(pdf.id, '/no-cover.png');
          img.src = url;
        }
      }
    });
  }, [sortedResults]);

  // Container colors
  function getContainerBg(bg, theme, step = 1) {
    if (!bg) return theme === 'dark' ? '#232323' : '#f5f5f5';
    const lum = getLuminance(bg);
    const direction = lum < 0.5 ? 1 : -1;
    return stepColor(bg, theme, step, direction);
  }
  const containerBg = getContainerBg(backgroundColor, theme, 1);
  const containerText = textColor;

  return (
    <div
      className={`search-results-page ${theme}-mode`}
      style={{ background: backgroundColor, color: textColor, minHeight: '100vh', padding: '32px 0' }}
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
              if (!pdf.id) {
                console.warn('[SearchResults] Rendering: invalid book id', pdf);
                return (
                  <li key={Math.random()} style={{ color: '#c00', fontSize: 14, marginBottom: 18 }}>
                    [No valid book id]
                  </li>
                );
              }
              return (
                <li key={pdf.id || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18, background: containerBg, color: containerText, borderRadius: 8, padding: '12px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  <img
                    src={getCoverFromCache(pdf.id)}
                    alt={pdf.title}
                    style={{ width: 60, height: 90, objectFit: 'cover', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                    onError={e => {
                      if (e.target.src !== '/no-cover.png') {
                        setCoverInCache(pdf.id, '/no-cover.png');
                        e.target.src = '/no-cover.png';
                      }
                    }}
                    onClick={e => {
                      // Only retry if cached is /no-cover.png
                      if (getCoverFromCache(pdf.id) === '/no-cover.png') {
                        const url = `${API_BASE_URL}/pdf-cover/${pdf.id}`;
                        const img = new window.Image();
                        img.onload = () => setCoverInCache(pdf.id, url);
                        img.onerror = () => setCoverInCache(pdf.id, '/no-cover.png');
                        img.src = url;
                        setTimeout(() => {
                          e.target.src = getCoverFromCache(pdf.id);
                        }, 500);
                      }
                    }}
                  />
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
                    <span style={{ color: '#0070f3', fontWeight: 600, fontSize: 15, marginRight: 8 }}>★ Favorited</span>
                  )}
                  <button
                    style={{ background: '#e0f7ff', color: '#0070f3', border: '1px solid #0070f3', borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
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
