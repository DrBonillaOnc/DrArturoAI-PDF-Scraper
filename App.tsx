import React, { useState, useCallback, useEffect } from 'react';
import type { PdfLink } from './types';
import { findAllLinksOnPage, findPdfLinksOnPage, downloadFileAsBlob, createZip, generatePdfPreview } from './services/agentService';

type AppState = 'idle' | 'discovering' | 'discovered' | 'scraping' | 'completed' | 'error';

const App: React.FC = () => {
  const [url, setUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Enter a URL to start.');
  const [appState, setAppState] = useState<AppState>('idle');
  
  const [discoveredLinks, setDiscoveredLinks] = useState<string[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
  
  const [pdfLinks, setPdfLinks] = useState<PdfLink[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);

  const resetState = () => {
    setUrl('');
    setIsLoading(false);
    setStatusMessage('Enter a URL to start.');
    setAppState('idle');
    setDiscoveredLinks([]);
    setSelectedLinks(new Set());
    setPdfLinks([]);
    if (zipUrl) {
      URL.revokeObjectURL(zipUrl);
    }
    setZipUrl(null);
  };
  
  const handleFindLinks = useCallback(async () => {
    if (!url) {
      setStatusMessage('Please enter a valid URL.');
      return;
    }

    setIsLoading(true);
    setAppState('discovering');
    setStatusMessage(`Finding all links on ${url}...`);
    setDiscoveredLinks([]);
    setSelectedLinks(new Set());
    setPdfLinks([]);
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    setZipUrl(null);

    try {
      const foundUrls = await findAllLinksOnPage(url);
      if (foundUrls.length === 0) {
        setStatusMessage('No navigable links found on the page.');
        setAppState('idle');
      } else {
        setDiscoveredLinks(foundUrls);
        setSelectedLinks(new Set(foundUrls)); // Select all by default
        setStatusMessage(`Found ${foundUrls.length} unique links. Select which pages to scan for PDFs.`);
        setAppState('discovered');
      }
    } catch (error) {
      console.error('An error occurred during link discovery:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      setStatusMessage(`Error: ${errorMessage}`);
      setAppState('error');
    } finally {
      setIsLoading(false);
    }
  }, [url, zipUrl]);
  
  const handleScrapePdfs = useCallback(async () => {
    if (selectedLinks.size === 0) {
        setStatusMessage('Please select at least one link to scrape.');
        return;
    }

    setIsLoading(true);
    setAppState('scraping');
    setStatusMessage('Initializing PDF scan...');
    setPdfLinks([]);

    try {
        let allPdfUrls = new Set<string>();
        const linksToScrape = Array.from(selectedLinks);

        for (let i = 0; i < linksToScrape.length; i++) {
            const linkUrl = linksToScrape[i];
            setStatusMessage(`Scanning page ${i + 1} of ${linksToScrape.length}: ${linkUrl.substring(0, 100)}...`);
            try {
                const foundPdfs = await findPdfLinksOnPage(linkUrl);
                foundPdfs.forEach(pdfUrl => allPdfUrls.add(pdfUrl));
            } catch (pageError) {
                console.warn(`Could not scrape ${linkUrl}:`, pageError);
            }
        }
        
        const uniquePdfUrls = Array.from(allPdfUrls);

        if (uniquePdfUrls.length === 0) {
            setStatusMessage('No PDF files found across the selected links. Try selecting different pages.');
            setAppState('discovered'); // Go back to the link selection screen
            setIsLoading(false);
            return;
        }

        setStatusMessage(`Found ${uniquePdfUrls.length} total PDF(s). Generating previews...`);

        const initialPdfLinks: PdfLink[] = uniquePdfUrls.map(linkUrl => ({
            url: linkUrl,
            status: 'pending',
            filename: linkUrl.substring(linkUrl.lastIndexOf('/') + 1) || 'document.pdf',
            selected: true,
        }));
        setPdfLinks(initialPdfLinks);

        initialPdfLinks.forEach(async (link) => {
            try {
                setPdfLinks(prev => prev.map(p => p.url === link.url ? { ...p, status: 'downloading' } : p));
                const blob = await downloadFileAsBlob(link.url);
                const previewUrl = await generatePdfPreview(blob);
                setPdfLinks(prev => prev.map(p => p.url === link.url ? { ...p, status: 'completed', blob, previewUrl } : p));
            } catch (error) {
                console.error(`Failed to process ${link.url}:`, error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                setPdfLinks(prev => prev.map(p => p.url === link.url ? { ...p, status: 'error', error: errorMessage } : p));
            }
        });

    } catch (error) {
        console.error('An error occurred during PDF scraping:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        setStatusMessage(`Error: ${errorMessage}`);
        setAppState('error');
        setIsLoading(false);
    }
  }, [selectedLinks]);

  useEffect(() => {
    if (appState === 'scraping' && pdfLinks.length > 0 && pdfLinks.every(p => p.status === 'completed' || p.status === 'error')) {
      setIsLoading(false);
      setAppState('completed');
      const completedCount = pdfLinks.filter(p => p.status === 'completed').length;
      if (completedCount > 0) {
        setStatusMessage(`Generated ${completedCount} previews. Select files to include in your ZIP.`);
      } else {
        setStatusMessage(`Could not generate any previews. Please check the console for errors.`);
      }
    }
  }, [pdfLinks, appState]);

  const handleToggleDiscoveredLink = (linkUrl: string) => {
    setSelectedLinks(prev => {
        const newSet = new Set(prev);
        if (newSet.has(linkUrl)) {
            newSet.delete(linkUrl);
        } else {
            newSet.add(linkUrl);
        }
        return newSet;
    });
  };

  const handleSelectAllLinks = (select: boolean) => {
    setSelectedLinks(select ? new Set(discoveredLinks) : new Set());
  };
  
  const handleTogglePdfSelection = (url: string) => {
    setPdfLinks(prev => prev.map(p => p.url === url ? { ...p, selected: !p.selected } : p));
  };

  const handleCreateZip = async () => {
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    
    const selectedPdfs = pdfLinks.filter(p => p.selected && p.status === 'completed');
    if (selectedPdfs.length === 0) {
      setStatusMessage('Please select at least one PDF to download.');
      return;
    }

    setIsLoading(true);
    setStatusMessage(`Zipping ${selectedPdfs.length} file(s)...`);
    
    try {
      const filesToZip = selectedPdfs.map(p => ({ name: p.filename, content: p.blob! }));
      const zipBlob = await createZip(filesToZip);
      const newZipUrl = URL.createObjectURL(zipBlob);
      setZipUrl(newZipUrl);
      setStatusMessage(`Success! ${selectedPdfs.length} PDF(s) are ready for download.`);
      
      const link = document.createElement('a');
      link.href = newZipUrl;
      link.setAttribute('download', 'scraped_pdfs.zip');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch(error) {
      console.error('Error creating zip file:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setStatusMessage(`Error creating ZIP: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  const selectedPdfCount = pdfLinks.filter(link => link.selected && link.status === 'completed').length;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-4xl mx-auto bg-slate-800/50 rounded-2xl shadow-2xl backdrop-blur-sm overflow-hidden border border-slate-700">
        <div className="p-6 md:p-8">
          <div className="text-center">
            <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300">PDF Scraper Agent</h1>
            <p className="mt-2 text-slate-400">Finds links, scrapes pages for PDFs, lets you preview, and bundles them into a ZIP file.</p>
          </div>
          
          {appState !== 'idle' && (
              <div className="text-center mt-4">
                  <button onClick={resetState} className="text-sm text-blue-400 hover:text-blue-300 transition">&larr; Start Over</button>
              </div>
          )}

          <div className="mt-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-grow w-full px-4 py-3 bg-slate-900/70 border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition duration-200 text-slate-200"
                disabled={isLoading || appState !== 'idle'}
              />
              <button
                onClick={handleFindLinks}
                disabled={isLoading || appState !== 'idle'}
                className="w-full sm:w-auto px-6 py-3 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
              >
                 {isLoading && appState==='discovering' ? ( <><svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Discovering...</> ) : (<> <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M9 9a2 2 0 114 0 2 2 0 01-4 0z" /><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-5.5-8a5.5 5.5 0 1111 0 5.5 5.5 0 01-11 0z" clipRule="evenodd" /></svg>Find Links</>)}
              </button>
            </div>
            <div className="px-4 py-3 bg-slate-900/50 rounded-lg border border-slate-700 min-h-[44px] flex items-center justify-center">
              <p className="text-slate-400 text-sm text-center">{statusMessage}</p>
            </div>
          </div>
        </div>

        {appState === 'discovered' && (
          <div className="border-t border-slate-700 px-6 md:px-8 py-4 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-lg text-slate-300">Select Pages to Scan</h3>
                <div className="space-x-3">
                    <button onClick={() => handleSelectAllLinks(true)} className="text-sm font-medium text-blue-400 hover:underline">Select All</button>
                    <button onClick={() => handleSelectAllLinks(false)} className="text-sm font-medium text-slate-500 hover:underline">Deselect All</button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto bg-slate-900/50 border border-slate-700 rounded-lg p-2 space-y-1">
                {discoveredLinks.map(link => (
                    <label key={link} className="flex items-center space-x-3 p-2 rounded-md hover:bg-slate-700/50 cursor-pointer transition-colors duration-150">
                        <input type="checkbox" checked={selectedLinks.has(link)} onChange={() => handleToggleDiscoveredLink(link)} className="form-checkbox h-5 w-5 text-blue-600 bg-slate-800 border-slate-600 rounded focus:ring-blue-500"/>
                        <span className="text-slate-300 text-sm truncate" title={link}>{link}</span>
                    </label>
                ))}
              </div>
              <button onClick={handleScrapePdfs} disabled={isLoading || selectedLinks.size === 0} className="w-full px-6 py-3 font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
                Scan for PDFs in Selected Pages ({selectedLinks.size})
              </button>
          </div>
        )}

        {(appState === 'scraping' || appState === 'completed') && pdfLinks.length > 0 && (
          <div className="border-t border-slate-700 px-6 md:px-8 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto p-1">
              {pdfLinks.map((link) => (
                <div key={link.url} className={`relative rounded-lg overflow-hidden border-2 transition-all duration-200 ${link.selected ? 'border-blue-500 shadow-lg' : 'border-slate-700'}`}>
                  <label htmlFor={link.url} className="absolute top-2 right-2 z-10 p-1.5 bg-slate-900/50 rounded-full cursor-pointer hover:bg-slate-900/80">
                    <input id={link.url} type="checkbox" checked={link.selected} onChange={() => handleTogglePdfSelection(link.url)} className="form-checkbox h-5 w-5 text-blue-600 bg-slate-800 border-slate-600 rounded focus:ring-blue-500" disabled={link.status !== 'completed'}/>
                  </label>
                  <div className="aspect-[3/4] bg-slate-700/50 flex items-center justify-center">
                    {(link.status === 'downloading' || appState === 'scraping' && link.status === 'pending') && <svg className="animate-spin h-8 w-8 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                    {link.status === 'completed' && link.previewUrl && <img src={link.previewUrl} alt={`Preview of ${link.filename}`} className="object-cover w-full h-full" />}
                    {link.status === 'error' && <div className="p-2 text-center text-red-400 text-xs flex flex-col items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{link.error}</div>}
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs text-white font-semibold truncate hover:underline" title={link.filename}>{link.filename}</a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {appState === 'completed' && (
          <div className="border-t border-slate-700 p-6 md:p-8">
             <button onClick={handleCreateZip} disabled={isLoading || selectedPdfCount === 0} className="w-full px-6 py-4 font-bold text-lg text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-slate-600/50 disabled:text-slate-400 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download ZIP ({selectedPdfCount} Selected)
            </button>
          </div>
        )}

        {(appState === 'error') && (
            <div className="border-t border-slate-700 p-6 md:p-8 text-center">
                <p className="text-red-400">An error occurred. Please try again or start over.</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default App;
