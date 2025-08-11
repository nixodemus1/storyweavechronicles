import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import "../styles/PDFReader.css";

export default function PDFReader() {
  const { id } = useParams(); // expecting route like /read/:id
  const [pdfData, setPdfData] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    fetch(`/api/pdf-text/${id}`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setPdfData(data);
        } else {
          console.error("Error loading PDF:", data.error);
        }
      })
      .catch(err => console.error(err));
  }, [id]);

  if (!pdfData) {
    return <div className="pdf-reader-loading">Loading PDF...</div>;
  }

  const page = pdfData.pages.find(p => p.page === currentPage);

  return (
    <div className="pdf-reader-container">
      <header className="pdf-reader-header">
        <button
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
        >
          ◀ Prev
        </button>
        <span>
          Page {currentPage} / {pdfData.totalPages || pdfData.pages.length}
        </span>
        <button
          onClick={() => setCurrentPage(p => Math.min((pdfData.totalPages || pdfData.pages.length), p + 1))}
          disabled={currentPage === (pdfData.totalPages || pdfData.pages.length)}
        >
          Next ▶
        </button>
      </header>

      <div className="pdf-reader-page">
        {page.images && page.images.length > 0 && (
          <div className="pdf-reader-images">
            {page.images.map((src, idx) => (
              <img key={idx} src={src} alt={`Page ${page.page} Image ${idx + 1}`} />
            ))}
          </div>
        )}

        {page.text && (
          <div className="pdf-reader-text">
            {page.text.split("\n").map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
