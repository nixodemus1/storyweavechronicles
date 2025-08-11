import "../styles/LandingPage.css";
import React, { useEffect, useState } from "react";
import Slider from "react-slick";
import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const [pdfs, setPdfs] = useState([]);
  const navigate = useNavigate();

  const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;

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
        }
      })
      .catch(err => console.error("Error fetching PDFs:", err));
  }, [folderId]);

  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 8,
    slidesToScroll: 1,
    arrows: true,
    adaptiveHeight: false,
    swipeToSlide: true, // Allow dragging to move by multiple slides
    draggable: true,
  };

  if (pdfs.length === 0) {
    return <div style={{ textAlign: "center", marginTop: "50px" }}>Loading...</div>;
  }

  // Top 10 newest
  const topNewest = pdfs.slice(0, 10);
  // Top 10 by votes (simulate with random order for now)
  const topVoted = pdfs.slice().sort(() => 0.5 - Math.random()).slice(0, 10);

  return (
    <div className="landing-page">
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
                style={{ cursor: 'pointer' }}
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
                <div className="book-title">{pdf.name}</div>
              </div>
            ))}
        </Slider>
      </div>
      <div className="landing-description">
        <p>Explore our collection of books and start reading today!</p>
        <div className="top-lists-container">
          <div className="top-list">
            <h3>Top 10 Newest</h3>
            <ol>
              {topNewest.map((pdf) => (
                <li key={pdf.id}>
                  <button className="top-list-link" onClick={() => navigate(`/read/${pdf.id}`)}>
                    {pdf.name}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="top-list">
            <h3>Top 10 by Votes</h3>
            <ol>
              {topVoted.map((pdf) => (
                <li key={pdf.id}>
                  <button className="top-list-link" onClick={() => navigate(`/read/${pdf.id}`)}>
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
