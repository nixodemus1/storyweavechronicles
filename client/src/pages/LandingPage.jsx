import React, { useEffect, useState, useContext } from "react";
import "../styles/LandingPage.css";
import Slider from "react-slick";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import { shadeColor } from "../utils/colorUtils";

export default function LandingPage() {
  const navigate = useNavigate();
  const { theme, backgroundColor, textColor } = useContext(ThemeContext);
  const [pdfs, setPdfs] = useState([]);
  const [topNewest, setTopNewest] = useState([]);
  const [topVoted, setTopVoted] = useState([]);
  const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;

  // Compute container background and text color variants automatically for contrast
  function getContainerBg(bg, theme) {
    // If bg is very light, darken; if very dark, lighten; else, shift by 8-12%
    // Use shadeColor utility
    // If bg is white or near-white, use light gray; if black or near-black, use dark gray
    if (!bg) return theme === 'dark' ? '#232323' : '#f5f5f5';
    const hex = bg.replace('#', '');
    const r = parseInt(hex.substring(0,2),16);
    const g = parseInt(hex.substring(2,4),16);
    const b = parseInt(hex.substring(4,6),16);
    const luminance = (0.299*r + 0.587*g + 0.114*b)/255;
    if (luminance > 0.85) return shadeColor(bg, -8); // very light, darken
    if (luminance < 0.15) return shadeColor(bg, 10); // very dark, lighten
    return shadeColor(bg, theme === 'dark' ? 10 : -8);
  }
  function getContainerText(containerBg, rootText) {
    // If containerBg is too close to rootText, invert
    // Otherwise, use rootText
    // For simplicity, just use rootText for now
    return rootText;
  }
  const containerBg = getContainerBg(backgroundColor, theme);
  const containerText = getContainerText(containerBg, textColor);

  // Carousel settings
  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 3,
    slidesToScroll: 1,
    centerMode: true,
    centerPadding: '40px',
    responsive: [
      { breakpoint: 900, settings: { slidesToShow: 2 } },
      { breakpoint: 600, settings: { slidesToShow: 1 } },
    ],
  };

  useEffect(() => {
    if (!folderId) return;
    fetch(`/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        if (data.pdfs) {
          // Sort newest first
          const sorted = data.pdfs.slice().sort((a, b) => {
            if (a.createdTime && b.createdTime) {
              return new Date(b.createdTime) - new Date(a.createdTime);
            }
            return 0;
          });
          setPdfs(sorted);
          setTopNewest(sorted.slice(0, 10));
          setTopVoted(sorted.slice().sort(() => 0.5 - Math.random()).slice(0, 10));
        }
      })
      .catch(err => console.error("Error fetching PDFs:", err));
  }, [folderId]);

  return (
    <div
      className={`landing-page ${theme}-mode`}
      style={{ background: backgroundColor, color: textColor, minHeight: '100vh' }}
    >
  {/* ...no container color pickers, only header pickers remain... */}
      <div className="searchbar-container">
        <input
          type="text"
          className="searchbar-input"
          placeholder="Search books (coming soon)"
          disabled
        />
      </div>
      <div className="carousel-container">
        <Slider {...settings}
          beforeChange={() => { window._carouselDragged = false; }}
          afterChange={() => { window._carouselDragged = false; }}
        >
          {pdfs
            .filter(pdf => pdf && pdf.id && pdf.name)
            .map((pdf) => (
              <div
                key={pdf.id}
                className="carousel-item"
                style={{ cursor: 'pointer', background: containerBg, color: containerText }}
                title={`Read ${pdf.name}`}
                onMouseDown={() => { window._carouselDragged = false; }}
                onMouseMove={() => { window._carouselDragged = true; }}
                onMouseUp={() => {
                  if (!window._carouselDragged) {
                    navigate(`/read/${pdf.id}`);
                  }
                }}
                onTouchStart={() => { window._carouselDragged = false; }}
                onTouchMove={() => { window._carouselDragged = true; }}
                onTouchEnd={() => {
                  if (!window._carouselDragged) {
                    navigate(`/read/${pdf.id}`);
                  }
                }}
              >
                <img
                  src={`/pdf-cover/${pdf.id}`}
                  alt={pdf.name}
                  className="book-cover"
                  onError={e => {
                    e.target.onerror = null;
                    e.target.src = 'https://via.placeholder.com/180x260?text=No+Cover';
                  }}
                />
                <div
                  className="book-title"
                  style={{
                    color: containerText,
                    background: containerBg,
                    padding: '0.25em 0.5em',
                    borderRadius: 4,
                    marginTop: 8
                  }}
                >
                  {pdf.name}
                </div>
              </div>
            ))}
        </Slider>
      </div>
  <div className="landing-description" style={{ background: containerBg, color: containerText }}>
        <p>
          Explore our collection of books and start reading today!
        </p>
        <div className="top-lists-container">
          <div className="top-list" style={{ background: backgroundColor, color: textColor }}>
            <h3 style={{ color: textColor }}>Top 10 Newest</h3>
            <ol>
              {topNewest.map((pdf) => (
                <li key={pdf.id}>
                  <button
                    className="top-list-link"
                    style={{ color: textColor }}
                    onClick={() => navigate(`/read/${pdf.id}`)}
                  >
                    {pdf.name}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="top-list" style={{ background: backgroundColor, color: textColor }}>
            <h3 style={{ color: textColor }}>Top 10 by Votes</h3>
            <ol>
              {topVoted.map((pdf) => (
                <li key={pdf.id}>
                  <button
                    className="top-list-link"
                    style={{ color: textColor }}
                    onClick={() => navigate(`/read/${pdf.id}`)}
                  >
                    {pdf.name}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
