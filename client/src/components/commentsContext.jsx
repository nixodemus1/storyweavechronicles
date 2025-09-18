import React, { useState, useEffect } from "react";
import { CommentsContext } from "./commentsContextDef";
export { CommentsContext };


export function CommentsProvider({ bookId, children }) {
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsPage, setCommentsPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [commentsRefresh, setCommentsRefresh] = useState(0);
  const [commentsPageSize, setCommentsPageSize] = useState(10);
  const [polling, setPolling] = useState(0);
  const [initialFetched, setInitialFetched] = useState(false);

  // Fetch comments only ONCE at mount/book/page change or on refresh
  useEffect(() => {
    setCommentsLoading(true);
    const params = new URLSearchParams();
    params.set('book_id', bookId);
    params.set('page', commentsPage);
    params.set('page_size', commentsPageSize);
    fetch(`${import.meta.env.VITE_HOST_URL}/api/get-comments?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        setComments(data.comments || []);
        setTotalPages(data.total_pages || 1);
        setCommentsLoading(false);
        setInitialFetched(true);
      });
  }, [bookId, commentsRefresh, commentsPage, commentsPageSize]);

  // Poll for new comments every 30s
  useEffect(() => {
    const interval = setInterval(() => setPolling(p => p + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Only re-fetch comments if backend signals new comments
  useEffect(() => {
    if (!initialFetched || commentsLoading) return;
    fetch(`${import.meta.env.VITE_HOST_URL}/api/has-new-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_id: bookId,
        page: commentsPage,
        page_size: commentsPageSize
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.has_new) {
          setCommentsLoading(true);
          const params = new URLSearchParams();
          params.set('book_id', bookId);
          params.set('page', commentsPage);
          params.set('page_size', commentsPageSize);
          fetch(`${import.meta.env.VITE_HOST_URL}/api/get-comments?${params.toString()}`)
            .then(res => res.json())
            .then(data => {
              setComments(data.comments || []);
              setTotalPages(data.total_pages || 1);
              setCommentsLoading(false);
            });
        }
      });
  }, [polling, bookId, commentsPage, commentsPageSize, initialFetched, commentsLoading]);

  const value = {
    comments,
    setComments,
    commentsLoading,
    setCommentsLoading,
    commentsPage,
    setCommentsPage,
    totalPages,
    setTotalPages,
    commentsRefresh,
    setCommentsRefresh,
    commentsPageSize,
    setCommentsPageSize,
  };
  return (
    <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
  );
}

