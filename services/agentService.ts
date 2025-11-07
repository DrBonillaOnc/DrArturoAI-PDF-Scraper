import type { FileContent, PdfLink } from '../types';

// Using a CORS proxy to bypass browser's same-origin policy.
// This is necessary for client-side fetching of cross-domain resources.
const CORS_PROXY = 'https://corsproxy.io/?';

/**
 * Fetches the HTML of a page and finds all direct links to PDF files.
 * @param pageUrl The URL of the webpage to scrape for PDFs.
 * @returns A promise that resolves to an array of absolute URLs to PDF files.
 */
export async function findPdfLinksOnPage(pageUrl: string): Promise<string[]> {
  const response = await fetch(`${CORS_PROXY}${encodeURIComponent(pageUrl)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch page: ${response.statusText}`);
  }
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const links = Array.from(doc.querySelectorAll('a'));
  
  const pdfUrls = links
    .map(link => link.getAttribute('href'))
    .filter((href): href is string => href !== null && href.toLowerCase().endsWith('.pdf'))
    .map(href => new URL(href, pageUrl).href); // Resolve relative URLs

  return [...new Set(pdfUrls)]; // Return unique URLs
}

/**
 * Fetches the HTML content of a given URL and finds all navigable hyperlinks.
 * @param pageUrl The URL of the webpage to scrape for links.
 * @returns A promise that resolves to an array of absolute URLs.
 */
export async function findAllLinksOnPage(pageUrl: string): Promise<string[]> {
    const response = await fetch(`${CORS_PROXY}${encodeURIComponent(pageUrl)}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch page: ${response.statusText}`);
    }
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));

    const allUrls = links
        .map(link => link.getAttribute('href'))
        .filter((href): href is string => {
            if (!href) return false;
            const trimmedHref = href.trim();
            // Basic filter to exclude in-page anchors and script/mailto links
            return !!trimmedHref && !trimmedHref.startsWith('#') && !trimmedHref.startsWith('javascript:') && !trimmedHref.startsWith('mailto:');
        })
        .map(href => {
            try {
                // Resolve relative URLs to be absolute
                return new URL(href, pageUrl).href;
            } catch (e) {
                // Ignore malformed URLs
                return null;
            }
        })
        .filter((href): href is string => href !== null);

    return [...new Set(allUrls)]; // Return unique URLs
}


/**
 * Downloads a file from a URL as a Blob.
 * @param fileUrl The URL of the file to download.
 * @returns A promise that resolves to a Blob object of the file content.
 */
export async function downloadFileAsBlob(fileUrl: string): Promise<Blob> {
    const response = await fetch(`${CORS_PROXY}${encodeURIComponent(fileUrl)}`);
    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
    }
    return response.blob();
}

/**
 * Creates a zip archive from a list of files.
 * @param files An array of FileContent objects, each with a name and content (Blob).
 * @returns A promise that resolves to a Blob of the generated zip file.
 */
export async function createZip(files: FileContent[]): Promise<Blob> {
    // JSZip is loaded from CDN and available on the window object
    const JSZip = (window as any).JSZip;
    if (!JSZip) {
        throw new Error('JSZip library not found. Please ensure it is loaded.');
    }
    const zip = new JSZip();
    files.forEach(file => {
        zip.file(file.name, file.content);
    });
    return zip.generateAsync({ type: 'blob' });
}

/**
 * Generates a Data URL preview of the first page of a PDF.
 * @param pdfBlob The Blob object of the PDF file.
 * @returns A promise that resolves to a Data URL (base64) of the rendered first page.
 */
export async function generatePdfPreview(pdfBlob: Blob): Promise<string> {
    // pdf.js is loaded from CDN and available on the window object
    const pdfjsLib = (window as any).pdfjsLib;
    if (!pdfjsLib) {
        throw new Error('pdf.js library not found. Please ensure it is loaded.');
    }
    // Set worker source for pdf.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.mjs`;

    const arrayBuffer = await pdfBlob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1); // Get the first page

    const scale = 0.4; // Thumbnail scale
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Could not create canvas context');
    }
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
        canvasContext: context,
        viewport: viewport,
    };

    await page.render(renderContext).promise;
    return canvas.toDataURL('image/jpeg', 0.8); // Return as JPEG for smaller size
}
