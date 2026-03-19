import React from 'react';
import { DocumentStyle, Chapter, LayoutType, Contact } from '../types';

interface PagePreviewProps {
  title?: string;
  titleFontSize?: number;
  subtitle?: string;
  subtitleFontSize?: number;
  authors?: string;
  authorsFontSize?: number;
  coverImage?: string | null;
  isCoverImageAiGenerated?: boolean;
  coverZoom?: number;
  coverPosition?: { x: number; y: number };
  chapter?: Chapter;
  style: DocumentStyle;
  isCover?: boolean;
  pageIndex?: number;
  layoutType?: LayoutType;
  contacts?: Contact[];
  contactsFontSizeOffset?: number;
  isUiPreview?: boolean;
}

const PagePreview: React.FC<PagePreviewProps> = ({ 
  title, 
  titleFontSize = 66.67,
  subtitle, 
  subtitleFontSize = 16,
  authors,
  authorsFontSize = 13.33,
  coverImage, 
  isCoverImageAiGenerated = false,
  coverZoom = 100,
  coverPosition = { x: 50, y: 50 },
  chapter, 
  style, 
  isCover = false,
  pageIndex = 0,
  layoutType = 'print',
  contacts = [],
  contactsFontSizeOffset = 0,
  isUiPreview = false
}) => {
  const sidebarWidth = 'w-[30%]';
  const mainWidth = 'w-[70%]';
  
  const isReverse = layoutType === 'print' && pageIndex % 2 !== 0;

  const isContacts = chapter?.id === 'chapter-contacts' || chapter?.title.toUpperCase() === 'CONTATTI';
  const isGrazie = chapter?.id === 'chapter-thanks' || chapter?.title.toUpperCase() === 'GRAZIE';

  const getContentFontSize = () => {
    // 16px leading 1.5 (leading-normal) as requested.
    return 'text-[16px] open-sans font-normal leading-normal';
  };

  const headerPaddingTop = '200px';
  // Padding for symmetrical borders (approx equal to px-12 which is 48px)
  const symmetricalPadding = '48px';

  return (
    <div 
        className={`page select-text overflow-hidden ${isUiPreview ? 'page-ui-preview' : ''} flex ${isReverse ? 'flex-row-reverse' : 'flex-row'}`} 
        style={{ backgroundColor: style.mainBg }}
    >
      {/* Sidebar Column (30%) */}
      <div 
        className={`${sidebarWidth} h-full max-h-full flex flex-col p-10 shrink-0 z-20 box-border select-text relative border-r-8`}
        style={{ 
          backgroundColor: style.sidebarBg, 
          color: style.sidebarText, 
          borderRightColor: isReverse ? 'transparent' : style.accentColor, 
          borderLeftWidth: isReverse ? '8px' : '0px', 
          borderLeftColor: isReverse ? style.accentColor : 'transparent',
          paddingTop: headerPaddingTop
        }}
      >
        {isCover ? (
          <div className="flex flex-col h-full justify-start relative z-30">
            {/* Autori: Montserrat Medium, Dimensione Dinamica, All Caps, spacing 200, supporta multiriga */}
            <div 
              className="montserrat-medium uppercase spacing-200 absolute -top-[160px] opacity-100 whitespace-pre-line"
              style={{ fontSize: `${authorsFontSize}px`, lineHeight: '1.4' }}
            >
              {authors || "AUTORI"}
            </div>
            
            <div className="flex flex-col py-4">
              {/* Titolo: ANTON, All Caps, Dimensione Dinamica, Supporta multiriga */}
              <h1 className="anton uppercase leading-[1.1] mb-8 break-words whitespace-pre-line" style={{ color: style.accentColor, fontSize: `${titleFontSize}px` }}>
                {title}
              </h1>
              {/* Sottotitolo Copertina: Montserrat Light, Dimensione Dinamica, All Caps, spacing 150, Supporta multiriga */}
              <h2 className="montserrat-light uppercase spacing-150 opacity-100 leading-tight whitespace-pre-line" style={{ fontSize: `${subtitleFontSize}px` }}>
                {subtitle}
              </h2>
            </div>
          </div>
        ) : isGrazie ? (
            <div className="flex flex-col h-full justify-start text-center items-center">
                <h2 className="anton text-[53.33px] uppercase leading-[1.1] px-4" style={{ color: style.accentColor }}>
                  {chapter?.title || "GRAZIE"}
                </h2>
                {chapter?.subtitle && (
                  <div className="montserrat-light text-[16px] uppercase spacing-150 mt-6 leading-relaxed max-w-xs whitespace-pre-line">
                    {chapter.subtitle}
                  </div>
                )}
                {chapter?.keywords && chapter.keywords.length > 0 && (
                  <div className="mt-auto pb-10">
                    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                      {chapter.keywords.map((kw, idx) => (
                        <li key={idx} className="montserrat italic text-[13.33px] leading-none flex items-center gap-2">
                          <span className="w-3 h-[2px] shrink-0" style={{ backgroundColor: style.accentColor }}></span>
                          {kw}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Titolo di Pagina: ANTON, 40pt (53.33px), All Caps, Left aligned */}
            <h2 className="anton uppercase leading-[1.1] mb-6 text-left" style={{ color: style.accentColor, fontSize: `${chapter?.titleFontSize || 53.33}px` }}>
              {chapter?.title.replace(/:$/, '').trim()}
            </h2>
            
            {/* Sottotitolo Pagina Secondaria: Montserrat Light, 12pt (16px), All Caps, spacing 150 */}
            <div className="montserrat-light uppercase spacing-150 mb-12 leading-normal whitespace-pre-line" style={{ fontSize: `${chapter?.subtitleFontSize || 16}px` }}>
              {chapter?.subtitle || ""}
            </div>
            
            {/* Sezione Parole Chiave: Montserrat 10pt (13.33px) Italic con trattino colorato, interlinea minima */}
            <div className="mt-auto pb-10">
              <ul className="space-y-1">
                {chapter?.keywords && chapter.keywords.map((kw, idx) => (
                  <li key={idx} className="montserrat text-[13.33px] italic leading-none flex items-center gap-3">
                    <span className="w-4 h-[2px] shrink-0" style={{ backgroundColor: style.accentColor }}></span>
                    {kw}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Column (70%) */}
      <div 
        className={`${mainWidth} h-full max-h-full relative overflow-hidden shrink-0 select-text flex flex-col`}
        style={{ 
            backgroundColor: style.mainBg, 
            color: style.mainText,
            padding: isCover ? '0px' : symmetricalPadding
        }}
      >
        {isCover ? (
          <div className="absolute inset-0 w-full h-full overflow-hidden flex items-center justify-center">
            {coverImage ? (
              <img 
                src={coverImage} 
                alt="Cover" 
                crossOrigin="anonymous"
                className="max-w-none max-h-none transition-none" 
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: isCoverImageAiGenerated ? 'cover' : 'contain',
                    transformOrigin: 'center',
                    transform: `translate(${(coverPosition.x - 50)}%, ${(coverPosition.y - 50)}%) scale(${coverZoom / 100})`,
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center opacity-20">
                <span className="text-slate-500 italic font-medium text-xs">Nessuna immagine</span>
              </div>
            )}
          </div>
        ) : isContacts ? (
          <div className="w-full h-full flex flex-col justify-end items-end text-right box-border select-text overflow-hidden relative">
            {/* Dynamic Contacts List - Aligned to bottom above company info */}
            <div className="w-full overflow-y-auto no-scrollbar mb-16">
               <div className="space-y-6 max-w-xl ml-auto w-full flex flex-col items-end">
                {contacts.map((c, i) => {
                  // Determiniamo se il blocco contatto ha un minimo di contenuto per essere visualizzato
                  const hasMinContent = c.name.trim() !== '' || c.email.trim() !== '' || (c.phone.trim() !== '' && c.phone.trim() !== '+39');
                  
                  return hasMinContent && (
                    <div key={i} className="space-y-1 text-right w-full animate-in fade-in slide-in-from-right-4 duration-500">
                      <p className="anton uppercase tracking-tight leading-none" style={{ color: style.sidebarBg, fontSize: `${24 + contactsFontSizeOffset}px` }}>{c.name}</p>
                      {c.role && <p className="montserrat-light opacity-90" style={{ fontSize: `${16 + contactsFontSizeOffset}px` }}>{c.role}</p>}
                      {c.email && <p className="montserrat-light opacity-80" style={{ fontSize: `${16 + contactsFontSizeOffset}px` }}>{c.email}</p>}
                      {/* Forziamo la visualizzazione del telefono se il blocco è attivo. Se vuoto o solo prefisso, mostriamo +39 */}
                      <p className="montserrat-light opacity-80" style={{ fontSize: `${14 + contactsFontSizeOffset}px` }}>{c.phone || '+39 '}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Fixed Company Info Block strictly at bottom */}
            <div className="w-full flex flex-col items-end text-right border-t border-slate-200/50 shrink-0 bg-transparent pt-8 pb-5">
              <div className="space-y-1 text-right">
                <p className="anton text-[20px] uppercase tracking-tight leading-none mb-4 whitespace-nowrap block" style={{ color: style.sidebarBg }}>
                  Compagnia Teatro dell'Argine
                </p>
                <div className="open-sans text-[12px] opacity-75 leading-[1.6] flex flex-col items-end">
                  <p>c/o ITC Teatro di San Lazzaro - via Rimembranze, 26</p>
                  <p>40068 - San Lazzaro di Savena (BO)</p>
                  <p>tel +39 051 6271604 | www.teatrodellargine.org</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-start justify-center box-border relative">
            {/* Chapter Image (if present) - positioned absolutely relative to this container */}
            {chapter?.image && (
              <div className="absolute inset-0 w-full h-full pointer-events-none flex items-center justify-center overflow-hidden z-0">
                <img 
                  src={chapter.image} 
                  alt="" 
                  className="max-w-none max-h-none transition-none"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    transformOrigin: 'center',
                    transform: `translate(${ ((chapter.imagePosition?.x ?? 50) - 50) }%, ${ ((chapter.imagePosition?.y ?? 50) - 50) }%) scale(${ (chapter.imageZoom ?? 100) / 100 })`,
                    opacity: 1
                  }}
                />
              </div>
            )}
            
            {/* Chapter Content Text - with higher z-index to stay above image if overlapping */}
            <div 
              className={`w-full max-h-full overflow-y-auto no-scrollbar select-text cursor-text text-justify hyphens-auto break-words whitespace-pre-line pr-4 relative z-10 ${getContentFontSize()}`}
              dangerouslySetInnerHTML={{ __html: chapter?.content || "" }}
            />
            {isGrazie && !chapter?.content && (
              <div className="anton text-slate-100 uppercase tracking-[4em] text-[12px] ml-[4em] opacity-30 text-center mt-20 relative z-10">TDA</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PagePreview;