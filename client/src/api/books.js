export async function fetchBooks(folderId) {
  const res = await fetch(`/list-pdfs/${folderId}`);
  return res.json();
}
