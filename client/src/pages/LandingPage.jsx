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
  React.useEffect(() => {
    let isMounted = true;
    const newCovers = {};
    pdfs.forEach(pdf => {
      if (!pdf.id) {
        console.warn('[LandingPage] Skipping cover preload: invalid book id', pdf);
        return;
      }
      const { url, expired } = getCoverFromCache(pdf.id);
      newCovers[pdf.id] = url;
      // Retry if expired or not cached
      if (!url || expired || (url.startsWith(API_BASE_URL) && url !== '/no-cover.png')) {
        if (url !== '/no-cover.png' || expired) {
          const coverUrl = `${API_BASE_URL}/pdf-cover/${pdf.id}`;
          const img = new window.Image();
          img.onload = () => setCoverInCache(pdf.id, coverUrl);
          img.onerror = () => setCoverInCache(pdf.id, '/no-cover.png');
          img.src = coverUrl;
        }
      }
    });
    if (isMounted) setCovers(newCovers);
    return () => { isMounted = false; };
  }, [pdfs]);
  return covers;
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
      navigate(`/read/${exactMatches[0].id}`);
      return;
    }
    // Prefix match on title or external_story_id
    const prefixMatches = pdfs.filter(pdf =>
      (pdf.title && pdf.title.toLowerCase().startsWith(q)) ||
      (pdf.external_story_id && pdf.external_story_id.toLowerCase().startsWith(q))
    );
    if (prefixMatches.length === 1) {
      navigate(`/read/${prefixMatches[0].id}`);
      return;
    }
    // Partial match on title or external_story_id
    const partialMatches = pdfs.filter(pdf =>
      (pdf.title && pdf.title.toLowerCase().includes(q)) ||
      (pdf.external_story_id && pdf.external_story_id.toLowerCase().includes(q))
    );
    if (partialMatches.length === 1) {
      navigate(`/read/${partialMatches[0].id}`);
      return;
    }
    navigate(`/search?query=${encodeURIComponent(searchInput)}`);
  };

  const handleAutocompleteClick = (pdf) => {
    setSearchInput("");
    setShowAutocomplete(false);
    navigate(`/read/${pdf.id}`);
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
  const covers = useCachedCovers(pdfs20);
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
            .map((pdf) => (
              <SteppedContainer depth={depth + 1} key={pdf.id || Math.random()} className="carousel-item" style={{ cursor: 'pointer' }}>
                {pdf.id ? (
                  <img
                    src={covers[pdf.id]}
                    alt={pdf.title}
                    className="book-cover"
                    onError={e => {
                      if (e.target.src !== '/no-cover.png') {
                        setCoverInCache(pdf.id, '/no-cover.png');
                        e.target.src = '/no-cover.png';
                      }
                    }}
                    onClick={e => {
                      // Always retry if cached is /no-cover.png
                      const { url } = getCoverFromCache(pdf.id);
                      if (url === '/no-cover.png') {
                        const coverUrl = `${API_BASE_URL}/pdf-cover/${pdf.id}`;
                        const img = new window.Image();
                        img.onload = () => setCoverInCache(pdf.id, coverUrl);
                        img.onerror = () => setCoverInCache(pdf.id, '/no-cover.png');
                        img.src = coverUrl;
                        setTimeout(() => {
                          e.target.src = getCoverFromCache(pdf.id).url;
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
                      if (!window._carouselDragged && pdf.id) navigate(`/read/${pdf.id}`);
                    }}
                    tabIndex={-1}
                    inert={false}
                  >
                    {pdf.title}
                  </button>
                </SteppedContainer>
              </SteppedContainer>
            ))}
        </Slider>
      </div>
    </SteppedContainer>
  );
}

function TopListsSection({ topNewest, topVoted, navigate, depth = 1 }) {
  const coversNewest = useCachedCovers(topNewest);
  const coversVoted = useCachedCovers(topVoted);
  return (
    <SteppedContainer depth={depth} className="landing-description" style={{ marginBottom: 32 }}>
      <p>
        Explore our collection of books and start reading today!
      </p>
      <div className="top-lists-container">
        <SteppedContainer depth={depth + 1} className="top-list" style={{ marginBottom: 16 }}>
          <h3>Top 10 Newest</h3>
          <ol>
            {topNewest.map((pdf) => (
              <li key={pdf.id || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {pdf.id ? (
                  <img src={coversNewest[pdf.id]}
                    alt={pdf.title}
                    style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 4 }}
                    onError={e => {
                      if (e.target.src !== '/no-cover.png') {
                        setCoverInCache(pdf.id, '/no-cover.png');
                        e.target.src = '/no-cover.png';
                      }
                    }}
                    onClick={e => {
                      const { url } = getCoverFromCache(pdf.id);
                      if (url === '/no-cover.png') {
                        const coverUrl = `${API_BASE_URL}/pdf-cover/${pdf.id}`;
                        const img = new window.Image();
                        img.onload = () => setCoverInCache(pdf.id, coverUrl);
                        img.onerror = () => setCoverInCache(pdf.id, '/no-cover.png');
                        img.src = coverUrl;
                        setTimeout(() => {
                          e.target.src = getCoverFromCache(pdf.id).url;
                        }, 500);
                      }
                    }} />
                ) : (
                  <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span> &&
                  (() => { console.warn('[LandingPage] TopNewest: invalid book id', pdf); })()
                )}
                <SteppedContainer depth={depth + 2} style={{ display: 'inline-block', borderRadius: 4 }}>
                  <button
                    className="top-list-link"
                    style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
                    onClick={() => pdf.id && navigate(`/read/${pdf.id}`)}
                  >
                    {pdf.title}
                  </button>
                </SteppedContainer>
              </li>
            ))}
          </ol>
        </SteppedContainer>
        <SteppedContainer depth={depth + 1} className="top-list">
          <h3>Top 10 by Votes</h3>
          <ol>
            {topVoted.map((pdf) => (
              <li key={pdf.id || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {pdf.id ? (
                  <img src={coversVoted[pdf.id]}
                    alt={pdf.title}
                    style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 4 }}
                    onError={e => {
                      if (e.target.src !== '/no-cover.png') {
                        setCoverInCache(pdf.id, '/no-cover.png');
                        e.target.src = '/no-cover.png';
                      }
                    }}
                    onClick={e => {
                      const { url } = getCoverFromCache(pdf.id);
                      if (url === '/no-cover.png') {
                        const coverUrl = `${API_BASE_URL}/pdf-cover/${pdf.id}`;
                        const img = new window.Image();
                        img.onload = () => setCoverInCache(pdf.id, coverUrl);
                        img.onerror = () => setCoverInCache(pdf.id, '/no-cover.png');
                        img.src = coverUrl;
                        setTimeout(() => {
                          e.target.src = getCoverFromCache(pdf.id).url;
                        }, 500);
                      }
                    }} />
                ) : (
                  <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span> &&
                  (() => { console.warn('[LandingPage] TopVoted: invalid book id', pdf); })()
                )}
                <SteppedContainer depth={depth + 2} style={{ display: 'inline-block', borderRadius: 4 }}>
                  <button
                    className="top-list-link"
                    style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
                    onClick={() => pdf.id && navigate(`/read/${pdf.id}`)}
                  >
                    {pdf.title}
                  </button>
                </SteppedContainer>
              </li>
            ))}
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

  // Fetch top 20 newest book IDs from /api/all-books (or paginated /list-pdfs if needed)
  useEffect(() => {
    setLoadingPdfs(true);
    fetch(`${API_BASE_URL}/api/all-books`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.books)) {
          // Get top 20 newest IDs
          const newestIds = data.books.slice(0, 20).map(b => b.id);
          if (newestIds.length > 0) {
            fetch(`${API_BASE_URL}/api/books?ids=${newestIds.join(',')}`)
              .then(res2 => res2.json())
              .then(data2 => {
                if (Array.isArray(data2.books)) {
                  setPdfs(data2.books);
                  setTopNewest(data2.books.slice(0, 10));
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
                  setTopVoted(data2.books.slice(0, 10));
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
        </div>
      </SteppedContainer>
    </ContainerDepthProvider>
  );
}
