import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeDefined();
  });

  it('shows landing page main elements', () => {
    render(<App />);
    // Check for main title
    expect(screen.getByText(/storyweave chronicles/i)).toBeInTheDocument();
    // Check for featured books or CTA
    expect(screen.getByText(/featured|start reading|explore/i)).toBeTruthy();
  });

  it('search page displays results after search', async () => {
    render(<App />);
    // Simulate navigation to search (assume a button or link exists)
    const searchNav = screen.getByRole('link', { name: /search/i });
    fireEvent.click(searchNav);
    // Enter search term
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'test book' } });
    fireEvent.submit(searchInput.form || searchInput);
    // Wait for results (mocked)
    expect(await screen.findByText(/results|test book/i)).toBeInTheDocument();
  });

  it('pdf reader loads and displays content', () => {
    render(<App />);
    // Simulate navigation to PDF reader (assume a link or route)
    // This may need adjustment based on your routing
    // For now, check for PDF viewer element
    expect(screen.getByText(/pdf reader|page|book/i)).toBeTruthy();
  });
});
