// LocalStorage cover cache utilities
const API_BASE_URL = import.meta.env.VITE_HOST_URL;
function getCoverFromCache(bookId) {
  try {
    const cache = JSON.parse(localStorage.getItem('swc_cover_cache') || '{}');
    const entry = cache[bookId];
    if (!entry) return { url: `${API_BASE_URL}/pdf-cover/${bookId}`, expired: false };
    if (typeof entry === 'string') {
      // Legacy: treat as url, no timestamp
      return { url: entry, expired: false };
    }
    // entry: { url, ts }
    if (entry.url === '/no-cover.png') {
      const now = Date.now();
      const expired = !entry.ts || (now - entry.ts > 3600 * 1000); // 1 hour expiry
      return { url: '/no-cover.png', expired };
    }
    return { url: entry.url, expired: false };
  } catch {
    return { url: `${API_BASE_URL}/pdf-cover/${bookId}`, expired: false };
  }
}
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
function useCachedCovers(pdfs) {
  const [covers, setCovers] = React.useState({});
  const [loadingCovers, setLoadingCovers] = React.useState({});
  const { user } = React.useContext(ThemeContext);
  React.useEffect(() => {
    let isMounted = true;
    const newCovers = {};
    const newLoading = {};
    pdfs.forEach(pdf => {
      const bookId = pdf.drive_id || pdf.id;
      if (!bookId) return;
      const { url, expired } = getCoverFromCache(bookId);
      newCovers[bookId] = url;
      // Track loading state
      if (!url || expired || (url.startsWith(API_BASE_URL) && url !== '/no-cover.png')) {
        newLoading[bookId] = true;
        let sessionId = (user && user.sessionId) || localStorage.getItem('swc_session_id');
        let coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
        if (sessionId) coverUrl += `?session_id=${encodeURIComponent(sessionId)}`;
        const img = new window.Image();
        img.onload = () => {
          setCoverInCache(bookId, coverUrl);
          setTimeout(() => {
            if (isMounted) setCovers(c => ({ ...c, [bookId]: coverUrl }));
            if (isMounted) setLoadingCovers(l => ({ ...l, [bookId]: false }));
          }, 0);
        };
        img.onerror = () => {
          setCoverInCache(bookId, '/no-cover.png');
          setTimeout(() => {
            if (isMounted) setCovers(c => ({ ...c, [bookId]: '/no-cover.png' }));
            if (isMounted) setLoadingCovers(l => ({ ...l, [bookId]: false }));
          }, 0);
        };
        img.src = coverUrl;
      } else {
        newLoading[bookId] = false;
      }
    });
    if (isMounted) setCovers(newCovers);
    if (isMounted) setLoadingCovers(newLoading);
    return () => { isMounted = false; };
  }, [pdfs, user]);
  return { covers, loadingCovers };
}
import React, { useEffect, useState, useContext } from "react";
import "../styles/LandingPage.css";
import Slider from "react-slick";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import { ContainerDepthProvider, SteppedContainer } from "../components/ContainerDepthContext";


function SearchBar({ pdfs, navigate }) {
  const [searchInput, setSearchInput] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState([]);
  const containerRef = React.useRef(null);
  const { backgroundColor } = useContext(ThemeContext);

  useEffect(() => {
    if (!searchInput.trim()) {
      setAutocompleteResults([]);
      return;
    }
    const q = searchInput.toLowerCase();
    const results = pdfs.filter(pdf => {
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
    setAutocompleteResults(results.slice(0, 8));
  }, [searchInput, pdfs]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
  const q = searchInput.toLowerCase();
  // Exact match on title or external_story_id
    const exactMatches = pdfs.filter(pdf =>
      (pdf.title && pdf.title.toLowerCase() === q) ||
      (pdf.external_story_id && pdf.external_story_id.toLowerCase() === q)
    );
    if (exactMatches.length === 1) {
      navigate(`/read/${exactMatches[0].drive_id}`);
      return;
    }
    // Prefix match on title or external_story_id
    const prefixMatches = pdfs.filter(pdf =>
      (pdf.title && pdf.title.toLowerCase().startsWith(q)) ||
      (pdf.external_story_id && pdf.external_story_id.toLowerCase().startsWith(q))
    );
    if (prefixMatches.length === 1) {
      navigate(`/read/${prefixMatches[0].drive_id}`);
      return;
    }
    // Partial match on title or external_story_id
    const partialMatches = pdfs.filter(pdf =>
      (pdf.title && pdf.title.toLowerCase().includes(q)) ||
      (pdf.external_story_id && pdf.external_story_id.toLowerCase().includes(q))
    );
    if (partialMatches.length === 1) {
      navigate(`/read/${partialMatches[0].drive_id}`);
      return;
    }
    navigate(`/search?query=${encodeURIComponent(searchInput)}`);
  };

  const handleAutocompleteClick = (pdf) => {
    setSearchInput("");
    setShowAutocomplete(false);
    navigate(`/read/${pdf.drive_id}`);
  };

  const handleBlur = () => {
    setTimeout(() => setShowAutocomplete(false), 120);
  };

  return (
  <SteppedContainer depth={0} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 32, marginTop: 32, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', position: 'relative', background: backgroundColor }} ref={containerRef}>
      <form onSubmit={handleSearchSubmit} autoComplete="off" style={{ width: '100%', maxWidth: 400, display: 'flex', justifyContent: 'center' }}>
          <input
            type="text"
            className="searchbar-input"
            placeholder="Search books by title..."
            value={searchInput}
            onChange={e => {
              setSearchInput(e.target.value);
              setShowAutocomplete(true);
            }}
            onFocus={() => setShowAutocomplete(true)}
            onBlur={handleBlur}
            style={{
              width: 340,
              maxWidth: '90vw',
              padding: '10px 14px',
              borderRadius: 6,
              fontSize: 18,
              border: '1.5px solid #bbb',
              color: 'inherit',
              background: backgroundColor, // base background color
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
            }}
          />
      </form>
      {showAutocomplete && autocompleteResults.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 340,
          border: `1px solid #bbb`,
          borderRadius: 6,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          maxHeight: 320,
          overflowY: 'auto',
          marginTop: 2,
          zIndex: 20,
          background: 'inherit'
        }}>
          {autocompleteResults.map(pdf => (
            <div
              key={pdf.id}
              className="autocomplete-item"
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid #eee',
                fontSize: 17
              }}
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleAutocompleteClick(pdf)}
            >
              {/* Only show title, no cover icon */}
              {pdf.title}
            </div>
          ))}
        </div>
      )}
    </SteppedContainer>
  );
}

function CarouselSection({ pdfs, navigate, settings, depth = 1 }) {
  const pdfs20 = React.useMemo(() => pdfs.slice(0, 20), [pdfs]);
  const { covers, loadingCovers } = useCachedCovers(pdfs20);
  // console.log('[CarouselSection] Rendering with covers:', covers);
  return (
    <SteppedContainer depth={depth} style={{ marginBottom: 32 }}>
      <div className="carousel-container">
        <Slider {...settings}
          beforeChange={() => { window._carouselDragged = false; }}
          afterChange={() => { window._carouselDragged = false; }}
        >
          {pdfs20
            .filter(pdf => pdf && pdf.title)
            .map((pdf) => {
              const bookId = pdf.drive_id;
              const coverUrl = covers[bookId];
              const isLoading = loadingCovers[bookId];
              return (
                <SteppedContainer depth={depth + 1} key={bookId || Math.random()} className="carousel-item" style={{ cursor: 'pointer' }}>
                  {bookId ? (
                    pdf.missing
                      ? <div style={{
                          width: 180, height: 270,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: '#eee', color: '#c00', borderRadius: 6,
                          fontSize: 18, fontStyle: 'italic', boxShadow: '0 2px 16px rgba(0,0,0,0.12)'
                        }}>Missing Book</div>
                      : isLoading
                        ? <div style={{
                            width: 180, height: 270,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: '#e0ffe0', color: '#080', borderRadius: 6,
                            fontSize: 18, fontStyle: 'italic', boxShadow: '0 2px 16px rgba(0,0,0,0.12)'
                          }}>Loading Cover...</div>
                        : coverUrl === '/no-cover.png'
                          ? <div style={{
                              width: 180, height: 270,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: '#ffe0e0', color: '#c00', borderRadius: 6,
                              fontSize: 18, fontStyle: 'italic', boxShadow: '0 2px 16px rgba(0,0,0,0.12)'
                            }}>No Cover</div>
                          : <img
                              src={coverUrl}
                              alt={pdf.title}
                              className="book-cover"
                              style={{ width: 170, height: 260, objectFit: 'cover', borderRadius: 6, boxShadow: '0 2px 16px rgba(0,0,0,0.12)' }}
                              onError={e => {
                                if (e.target.src !== '/no-cover.png') {
                                  setCoverInCache(bookId, '/no-cover.png');
                                  e.target.src = '/no-cover.png';
                                }
                              }}
                              onClick={e => {
                                const { url } = getCoverFromCache(bookId);
                                if (url === '/no-cover.png') {
                                  const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
                                  const img = new window.Image();
                                  img.onload = () => setCoverInCache(bookId, coverUrl);
                                  img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
                                  img.src = coverUrl;
                                  setTimeout(() => {
                                    e.target.src = getCoverFromCache(bookId).url;
                                  }, 500);
                                }
                              }}
                            />
                  ) : (
                    <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span>
                  )}
                  <SteppedContainer depth={depth + 2} className="book-title" style={{ padding: '0.25em 0.5em', borderRadius: 4, marginTop: 8 }}>
                    <button
                      style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'inherit' }}
                      onClick={() => {
                        if (!window._carouselDragged && bookId) navigate(`/read/${bookId}`);
                      }}
                      tabIndex={-1}
                      inert={false}
                    >
                      {pdf.title}
                    </button>
                  </SteppedContainer>
                </SteppedContainer>
              );
            })}
        </Slider>
      </div>
    </SteppedContainer>
  );
}

function TopListsSection({ topNewest, topVoted, navigate, depth = 1 }) {
  const { covers: coversNewest, loadingCovers: loadingNewest } = useCachedCovers(topNewest);
  const { covers: coversVoted, loadingCovers: loadingVoted } = useCachedCovers(topVoted);
  return (
    <SteppedContainer depth={depth} className="landing-description" style={{ marginBottom: 32 }}>
      <p>Explore our collection of books and start reading today!</p>
      <div className="top-lists-container">
        <SteppedContainer depth={depth + 1} className="top-list" style={{ marginBottom: 16 }}>
          <h3>Top 10 Newest</h3>
          <ol>
            {topNewest.map((pdf) => {
              const bookId = pdf.drive_id;
              const coverUrl = coversNewest[bookId];
              const isLoading = loadingNewest[bookId];
              return (
                <li key={bookId || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {bookId ? (
                    isLoading ? (
                      <div style={{
                        width: 64, height: 96,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#e0ffe0', color: '#080', borderRadius: 6,
                        fontSize: 16, fontStyle: 'italic', boxShadow: '0 2px 8px rgba(0,0,0,0.10)'
                      }}>Loading Cover...</div>
                    ) : coverUrl === '/no-cover.png' ? (
                      <div style={{
                        width: 64, height: 96,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#ffe0e0', color: '#c00', borderRadius: 6,
                        fontSize: 16, fontStyle: 'italic', boxShadow: '0 2px 8px rgba(0,0,0,0.10)'
                      }}>No Cover</div>
                    ) : (
                      <img src={coverUrl}
                        alt={pdf.title}
                        style={{ width: 64, height: 96, objectFit: 'cover', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}
                        onError={e => {
                          if (e.target.src !== '/no-cover.png') {
                            setCoverInCache(bookId, '/no-cover.png');
                            e.target.src = '/no-cover.png';
                          }
                        }}
                        onClick={e => {
                          const { url } = getCoverFromCache(bookId);
                          if (url === '/no-cover.png') {
                            const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
                            const img = new window.Image();
                            img.onload = () => setCoverInCache(bookId, coverUrl);
                            img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
                            img.src = coverUrl;
                            setTimeout(() => {
                              e.target.src = getCoverFromCache(bookId).url;
                            }, 500);
                          }
                        }} />
                    )
                  ) : (
                    <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span>
                  )}
                  <SteppedContainer depth={depth + 2} style={{ display: 'inline-block', borderRadius: 4 }}>
                    <button
                      className="top-list-link"
                      style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
                      onClick={() => bookId && navigate(`/read/${bookId}`)}
                    >
                      {pdf.title}
                    </button>
                  </SteppedContainer>
                </li>
              );
            })}
          </ol>
        </SteppedContainer>
        <SteppedContainer depth={depth + 1} className="top-list">
          <h3>Top 10 by Votes</h3>
          <ol>
            {topVoted.map((pdf) => {
              const bookId = pdf.drive_id;
              const coverUrl = coversVoted[bookId];
              const isLoading = loadingVoted[bookId];
              return (
                <li key={bookId || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {bookId ? (
                    isLoading ? (
                      <div style={{
                        width: 64, height: 96,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#e0ffe0', color: '#080', borderRadius: 6,
                        fontSize: 16, fontStyle: 'italic', boxShadow: '0 2px 8px rgba(0,0,0,0.10)'
                      }}>Loading Cover...</div>
                    ) : coverUrl === '/no-cover.png' ? (
                      <div style={{
                        width: 64, height: 96,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#ffe0e0', color: '#c00', borderRadius: 6,
                        fontSize: 16, fontStyle: 'italic', boxShadow: '0 2px 8px rgba(0,0,0,0.10)'
                      }}>No Cover</div>
                    ) : (
                      <img src={coverUrl}
                        alt={pdf.title}
                        style={{ width: 64, height: 96, objectFit: 'cover', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }}
                        onError={e => {
                          if (e.target.src !== '/no-cover.png') {
                            setCoverInCache(bookId, '/no-cover.png');
                            e.target.src = '/no-cover.png';
                          }
                        }}
                        onClick={e => {
                          const { url } = getCoverFromCache(bookId);
                          if (url === '/no-cover.png') {
                            const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
                            const img = new window.Image();
                            img.onload = () => setCoverInCache(bookId, coverUrl);
                            img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
                            img.src = coverUrl;
                            setTimeout(() => {
                              e.target.src = getCoverFromCache(bookId).url;
                            }, 500);
                          }
                        }} />
                    )
                  ) : (
                    <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span>
                  )}
                  <SteppedContainer depth={depth + 2} style={{ display: 'inline-block', borderRadius: 4 }}>
                    <button
                      className="top-list-link"
                      style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
                      onClick={() => bookId && navigate(`/read/${bookId}`)}
                    >
                      {pdf.title}
                    </button>
                  </SteppedContainer>
                </li>
              );
            })}
          </ol>
        </SteppedContainer>
      </div>
    </SteppedContainer>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { theme, backgroundColor: _backgroundColor, textColor } = useContext(ThemeContext);

  const [pdfs, setPdfs] = useState([]);
  const [topNewest, setTopNewest] = useState([]);
  const [topVoted, setTopVoted] = useState([]);
  const [loadingPdfs, setLoadingPdfs] = useState(false);
  // ...existing code...
  const API_BASE_URL = import.meta.env.VITE_HOST_URL;

  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 10,
    slidesToScroll: 1,
    centerMode: true,
    centerPadding: '40px',
    swipeToSlide: true,
    responsive: [
      { breakpoint: 900, settings: { slidesToShow: 2 } },
      { breakpoint: 600, settings: { slidesToShow: 1 } },
    ],
  };

  // Fetch top 20 newest book IDs from /api/all-books
  useEffect(() => {
    setLoadingPdfs(true);
    fetch(`${API_BASE_URL}/api/all-books`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.books)) {
          const newestIds = data.books.slice(0, 20).map(b => b.id);
          if (newestIds.length > 0) {
            fetch(`${API_BASE_URL}/api/books?ids=${newestIds.join(',')}`)
              .then(res2 => res2.json())
              .then (data2 => {
                if (Array.isArray(data2.books)) {
                  // Patch: ensure every book has drive_id
                  const patchedBooks = data2.books.map(b => ({ ...b, drive_id: b.drive_id || b.id }));
                  setPdfs(patchedBooks);
                  setTopNewest(patchedBooks.slice(0, 10));
                }
                setLoadingPdfs(false);
              })
              .catch(err => {
                console.error("Error fetching books by ids:", err);
                setLoadingPdfs(false);
              });
          } else {
            setLoadingPdfs(false);
          }
        } else {
          setLoadingPdfs(false);
        }
      })
      .catch(err => {
        console.error("Error fetching all books:", err);
        setLoadingPdfs(false);
      });
  }, [API_BASE_URL]);

  // Fetch top voted book IDs and then fetch their details
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/top-voted-books`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.books)) {
          const votedIds = data.books.map(b => b.id || b.book_id).filter(Boolean);
          if (votedIds.length > 0) {
            fetch(`${API_BASE_URL}/api/books?ids=${votedIds.join(',')}`)
              .then(res2 => res2.json())
              .then(data2 => {
                if (Array.isArray(data2.books)) {
                  // Patch: ensure every book has drive_id
                  const patchedBooks = data2.books.map(b => ({ ...b, drive_id: b.drive_id || b.id }));
                  setTopVoted(patchedBooks.slice(0, 10));
                }
              })
              .catch(err => {
                console.error("Error fetching voted books by ids:", err);
              });
          }
        }
      })
      .catch(err => {
        console.error("Error fetching top voted books:", err);
      });
  }, [API_BASE_URL]);

  // Helper to clear all cover cache and trigger re-fetch
  function retryAllCovers() {
    try {
      localStorage.removeItem('swc_cover_cache');
      // Optionally, force a re-render by updating state
      setPdfs(pdfs => [...pdfs]);
      setTopNewest(topNewest => [...topNewest]);
      setTopVoted(topVoted => [...topVoted]);
    } catch (e) {
      console.log("Error clearing cover cache:", e);
    }
  }

  return (
    <ContainerDepthProvider>
      <SteppedContainer depth={0} style={{ minHeight: '100vh', padding: 0 }}>
        <div className={`landing-page ${theme}-mode`} style={{ background: 'transparent', color: textColor, minHeight: '100vh' }}>
          <SearchBar pdfs={pdfs} navigate={navigate} depth={1} />
          <CarouselSection pdfs={pdfs} navigate={navigate} settings={settings} depth={1} />
          <TopListsSection topNewest={topNewest} topVoted={topVoted} navigate={navigate} depth={1} />
          {loadingPdfs && (
            <div style={{ textAlign: 'center', color: '#888', margin: 24 }}>Loading more books...</div>
          )}
          {/* Retry covers button at the very bottom */}
          <SteppedContainer depth={1} style={{ width: '100%', display: 'flex', justifyContent: 'center', marginTop: 40, marginBottom: 24, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <button
              onClick={retryAllCovers}
              style={{
                padding: '10px 28px',
                borderRadius: 8,
                border: `1.5px solid ${textColor}`,
                background: _backgroundColor,
                color: textColor,
                fontWeight: 700,
                fontSize: 18,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
              }}
            >Retry All Covers</button>
          </SteppedContainer>
        </div>
      </SteppedContainer>
    </ContainerDepthProvider>
  );
}
