export type PdfLinkStatus = 'pending' | 'downloading' | 'completed' | 'error';

export interface PdfLink {
  url: string;
  status: PdfLinkStatus;
  filename: string;
  error?: string;
  previewUrl?: string; // Data URL for the first page image
  selected: boolean;   // To control which PDFs are included in the zip
  blob?: Blob;         // Store the downloaded file content
}

export interface FileContent {
  name: string;
  content: Blob;
}