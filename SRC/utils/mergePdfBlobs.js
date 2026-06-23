import { PDFDocument } from 'pdf-lib';

/** Merge PDF blobs in order (used for bulk sale-bill PDF). */
export async function mergePdfBlobs(blobs) {
  if (!blobs?.length) throw new Error('No PDF pages to merge.');
  if (blobs.length === 1) return blobs[0];
  const merged = await PDFDocument.create();
  for (const blob of blobs) {
    const bytes = await blob.arrayBuffer();
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  const out = await merged.save();
  return new Blob([out], { type: 'application/pdf' });
}

export function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
