import React, { useState, useEffect } from "react";
import { fetchBooks } from "../src/api/books";

export default function BooksViewer() {
  const [pdfs, setPdfs] = useState([]);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const folderId = "1qb8-tesI1rQjNLlRuVE7fDot5xiNgeO8"; // Your real folder ID

  useEffect(() => {
    const fetchPdfs = async () => {
      try {
        const data = await fetchBooks(folderId);

        if (data.error && data.error.includes("No valid credentials")) {
          window.location.href = "/authorize";
        } else {
          setPdfs(data.pdfs || []);
        }
      } catch (err) {
        console.error("Error fetching PDFs:", err);
      }
    };

    fetchPdfs();
  }, [folderId]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar */}
      <div style={{ width: "25%", padding: "1rem", background: "#f0f0f0" }}>
        <h2>Books</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {pdfs.map((pdf) => (
            <li
              key={pdf.id}
              style={{
                padding: "0.5rem",
                cursor: "pointer",
                background:
                  selectedPdf && selectedPdf.id === pdf.id ? "#ddd" : "transparent",
              }}
              onClick={() => setSelectedPdf(pdf)}
            >
              {pdf.name}
            </li>
          ))}
        </ul>
      </div>

      {/* PDF Viewer */}
      <div style={{ flex: 1 }}>
        {selectedPdf ? (
          <iframe
            src={`/view-pdf/${selectedPdf.id}`}
            style={{ width: "100%", height: "100%", border: "none" }}
            title={selectedPdf.name}
          />
        ) : (
          <p style={{ padding: "1rem" }}>Select a book to read</p>
        )}
      </div>
    </div>
  );
}
