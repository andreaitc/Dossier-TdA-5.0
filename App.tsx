import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Save, History, Download, Upload, MoreVertical, X, ChevronLeft, ChevronRight, ArrowDown, Plus, Check, Star, Trash2, ChevronsLeft, ChevronsRight, BookOpen, Mic, Square, Sparkles, FileText, ArrowRight } from 'lucide-react';
import { Step, AppState, Chapter, DocumentStyle, LayoutType, Contact } from './types';
// Fix: Use default import for StepIndicator as StepIndicator.tsx provides a default export
import StepIndicator from './components/StepIndicator';
import PagePreview from './components/PagePreview';
import { analyzeContent, generateCoverImage, generateMetaFromContent, CURRICULUM_TDA, transcribeAudio } from './services/geminiService';
import { removeBackground } from '@imgly/background-removal';
import pptxgen from "pptxgenjs";
import mammoth from 'mammoth';
import { jsPDF } from 'jspdf';
import * as htmlToImage from 'html-to-image';

export const TDA_LOGO_URL = "https://raw.githubusercontent.com/teatrodellargine/assets/main/logo_tda.png";

const makeWhiteTransparent = async (dataUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        // Calculate luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
        
        // Graphite color
        data[i] = 40;     // R
        data[i + 1] = 40; // G
        data[i + 2] = 40; // B
        
        // Convert luminance to alpha (white becomes transparent, black becomes opaque)
        // Multiply by 1.2 to slightly increase contrast of the strokes
        const newAlpha = Math.min(255, (255 - luminance) * 1.2);
        
        data[i + 3] = Math.min(a, newAlpha);
      }
      
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

const STORAGE_KEY = 'tda_dossier_project_v1';
const HISTORY_KEY = 'tda_dossier_history';
const MAX_HISTORY_ITEMS = 20;

/**
 * IndexedDB Utility for larger storage and history
 */
const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("TDADossierDB", 4); // Version 4
  request.onupgradeneeded = (event: any) => {
    const db = request.result;
    if (!db.objectStoreNames.contains("projects")) {
      db.createObjectStore("projects");
    }
    if (!db.objectStoreNames.contains("history")) {
      db.createObjectStore("history", { keyPath: "timestamp" });
    }
    if (!db.objectStoreNames.contains("favorites")) {
      db.createObjectStore("favorites", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("settings")) {
      db.createObjectStore("settings");
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const saveToDB = async (storeName: string, key: string | null, val: any) => {
  const db = await dbPromise;
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  if (key) {
    store.put(val, key);
  } else {
    store.put(val);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
};

const getFromDB = async (storeName: string, key: string) => {
  const db = await dbPromise;
  const tx = db.transaction(storeName, "readonly");
  const request = tx.objectStore(storeName).get(key);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getAllFromDB = async (storeName: string) => {
  const db = await dbPromise;
  const tx = db.transaction(storeName, "readonly");
  const request = tx.objectStore(storeName).getAll();
  return new Promise<any[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const removeFromDB = async (storeName: string, key: string) => {
  const db = await dbPromise;
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
};

const deleteOldestHistoryForProject = async (projectTitle: string) => {
  const db = await dbPromise;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("history", "readwrite");
    const store = tx.objectStore("history");
    const request = store.getAll();
    
    request.onsuccess = () => {
      const items = request.result;
      const projectItems = items.filter((item: any) => (item.projectTitle || item.state?.title || 'Senza Titolo') === projectTitle);
      
      if (projectItems.length > MAX_HISTORY_ITEMS) {
        // Sort items by timestamp ascending
        const sortedItems = projectItems.sort((a: any, b: any) => a.timestamp - b.timestamp);
        const itemsToDelete = sortedItems.slice(0, sortedItems.length - MAX_HISTORY_ITEMS);
        
        let deletedCount = 0;
        if (itemsToDelete.length === 0) resolve();
        
        itemsToDelete.forEach((item: any) => {
          const delRequest = store.delete(item.timestamp);
          delRequest.onsuccess = () => {
            deletedCount++;
            if (deletedCount === itemsToDelete.length) resolve();
          };
          delRequest.onerror = () => reject(delRequest.error);
        });
      } else {
        resolve();
      }
    };
    
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const DEFAULT_TITLE_FONT_SIZE = 66.67;
const DEFAULT_AUTHORS_FONT_SIZE = 13.33;
const DEFAULT_SUBTITLE_FONT_SIZE = 16;

/**
 * Utility to wrap a promise with a timeout.
 */
const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
};

/**
 * Utility to resize and compress images before storing them in state.
 * Preserves transparency for PNG and GIF files.
 */
const processAndResizeImage = (file: File, maxWidth = 1920, MAXHEIGHT = 1080): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > MAXHEIGHT) {
            width *= MAXHEIGHT / height;
            height = MAXHEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }

        // Clear canvas to ensure transparency is handled correctly
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        // Determine output format based on source file type to preserve transparency
        const isTransparentFormat = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp';
        const format = isTransparentFormat ? 'image/png' : 'image/jpeg';
        const quality = isTransparentFormat ? undefined : 0.8;
        
        resolve(canvas.toDataURL(format, quality));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

const PALETTES = [
  { name: "Moka & Biscotto", style: { sidebarBg: "#3D2B1F", mainBg: "#F5F5DC", sidebarText: "#F5F5DC", mainText: "#333333", accentColor: "#D4AF37" } },
  { name: "Ardesia & Perla", style: { sidebarBg: "#2F4F4F", mainBg: "#F8F9FA", sidebarText: "#FFFFFF", mainText: "#333333", accentColor: "#FFFFFF" } },
  { name: "Grafite & Argento", style: { sidebarBg: "#212529", mainBg: "#F8F9FA", sidebarText: "#E0E0E0", mainText: "#333333", accentColor: "#FFFFFF" } },
  { name: "Teal & Alga", style: { sidebarBg: "#004D40", mainBg: "#E0F2F1", sidebarText: "#FFF9C4", mainText: "#333333", accentColor: "#FFF9C4" } },
  { name: "Caffè & Crema", style: { sidebarBg: "#4E342E", mainBg: "#FFF3E0", sidebarText: "#FFF3E0", mainText: "#333333", accentColor: "#CD7F32" } },
  { name: "Lusso Silenzioso", style: { sidebarBg: "#1A362D", mainBg: "#FDFBF7", sidebarText: "#F4EEDF", mainText: "#424242", accentColor: "#B8975E" } },
  { name: "Tech Contemporaneo", style: { sidebarBg: "#0B132B", mainBg: "#F4F6F9", sidebarText: "#8DA9C4", mainText: "#4A5568", accentColor: "#4DCCBD" } },
  { name: "Monocromo Nordico", style: { sidebarBg: "#5E5A54", mainBg: "#FAFAFA", sidebarText: "#FFFFFF", mainText: "#4A443E", accentColor: "#A65D46" } },
  { name: "Grafite & Carta", style: { sidebarBg: "#2D3142", mainBg: "#F1F2F6", sidebarText: "#BFC0C0", mainText: "#4F5D75", accentColor: "#EF8354" } },
  { name: "Lavanda & Lino", style: { sidebarBg: "#584A66", mainBg: "#F7F5FA", sidebarText: "#EEDCE3", mainText: "#4A3B52", accentColor: "#9B72AA" } },
  { name: "Brezza Marina", style: { sidebarBg: "#1A505B", mainBg: "#F0F7F4", sidebarText: "#A8DADC", mainText: "#2F4858", accentColor: "#E9C46A" } },
  { name: "Tramonto Pesca", style: { sidebarBg: "#D48265", mainBg: "#FFF8F0", sidebarText: "#FFEED2", mainText: "#4A3728", accentColor: "#9E4528" } },
  { name: "Adrenalina Pura", style: { sidebarBg: "#D90429", mainBg: "#EDF2F4", sidebarText: "#FFFFFF", mainText: "#2B2D42", accentColor: "#141414" } },
  { name: "Neon Runner", style: { sidebarBg: "#121212", mainBg: "#EFEFEF", sidebarText: "#CCFF00", mainText: "#505050", accentColor: "#CCFF00" } },
  { name: "Oceano Attivo", style: { sidebarBg: "#003049", mainBg: "#F8F9FA", sidebarText: "#669BBC", mainText: "#3A506B", accentColor: "#F77F00" } },
  { name: "Cyberpunk Vibe", style: { sidebarBg: "#2A004D", mainBg: "#F4F0FF", sidebarText: "#39FF14", mainText: "#362B48", accentColor: "#FF00FF" } },
  { name: "Streetwear Bubblegum", style: { sidebarBg: "#2B3A67", mainBg: "#FDFDFA", sidebarText: "#7FFFD4", mainText: "#333333", accentColor: "#FF1493" } },
  { name: "Z-Gen Creator", style: { sidebarBg: "#1E1E24", mainBg: "#FFFFFA", sidebarText: "#FB3640", mainText: "#4A4A48", accentColor: "#00F0FF" } },
  { name: "Gala Invernale", style: { sidebarBg: "#0F4C3A", mainBg: "#FCFDFD", sidebarText: "#A3C1AD", mainText: "#2A3F35", accentColor: "#D4AF37" } },
  { name: "Notte di Celebrazione", style: { sidebarBg: "#4A051C", mainBg: "#FDF7F8", sidebarText: "#FADADD", mainText: "#422933", accentColor: "#B87333" } },
];

const DEFAULT_STATE: AppState = {
  title: "TITOLO PROGETTO",
  titleFontSize: DEFAULT_TITLE_FONT_SIZE,
  subtitle: "SOTTOTITOLO",
  subtitleFontSize: DEFAULT_SUBTITLE_FONT_SIZE,
  authors: "Teatro dell'Argine",
  authorsFontSize: DEFAULT_AUTHORS_FONT_SIZE,
  coverSubject: "",
  coverStyle: "", 
  coverImage: null,
  isCoverImageAiGenerated: false,
  coverZoom: 100,
  coverPosition: { x: 50, y: 50 },
  style: PALETTES[0].style,
  chapters: [],
  layoutType: 'computer',
  contacts: [
    { name: '', email: '', phone: '+39 ' }
  ],
  contactsFontSizeOffset: 0,
  currentStep: Step.Selection,
  inputText: "",
  uploadedFileNames: [],
  favorites: [],
  palettes: PALETTES
};

const LABEL_MAP: Record<string, string> = {
  sidebarBg: "Sfondo Colonna Piccola",
  sidebarText: "Testo Colonna Piccola",
  accentColor: "Colore Titolo",
  mainBg: "Sfondo Colonna Grande",
  mainText: "Testo Colonna Grande"
};

// Exactly 1300 characters including spaces
const MOCK_TEXT_1300 = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur eget lacus non nisl mattis finibus. Etiam lacinia, lectus non efficitur luctus, felis mauris sodales diam, ut sodales urna ex in nulla. Donec elementum accumsan nisl, vel dapibus nisl faucibus at. Morbi cursus, sapien id aliquam blandit, enim enim molestie eros, id porta nisl felis quis magna. Curabitur vel enim a mi efficitat feugiat. Sed vulputate risus non leo facilisis, quis feugiat diam accumsan. Quisque sodales ex sed arcu semper, nec vehicula est sodales. Vestibulum viverra ligula vel nunc volutpat, vel pharetra odio blandit. Sed sit amet mauris sit amet nulla scelerisque dictum. Nullam sed tincidunt nisl. Integer dictum sem ut eros tristique, at molestie nulla lacinia. Fusce ut facilisis leo. Aenean vel elit nec sem placerat dignissim. Sed scelerisque_dolor id dolor dictum, vitae convallis mauris ullamcorper. Pellentesque hendrerit odio at lectus interdum elementum. Suspendisse non sapien vel elit rhoncus pellentesque. Pellentesque eu justo nec dolor faucibus fringilla. Phasellus tincidunt nulla ac leo. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. In hac habitasse platea dictumst. Quisque iaculis massa sit amet giusto fermentum, quis sodales nibh ultrices. Nulla facilisi. Proin id est vel odio varius euismod. Duis ut nunc nec nibh semper hendrerit. Etiam id felis ac turpis fine.`;

const STYLE_CATEGORIES = {
  Tecnica: [
    { name: "Fumetto", desc: "Linee nere marcate e colori piatti." },
    { name: "Acquerello", desc: "Tratti fluidi, macchie di colore, bordi bagnati." },
    { name: "Matita a mano libera", desc: "Schizzo a matita minimalista e gestuale, silhouette elegante." },
    { name: "Matita light", desc: "Schizzo a matita leggero con linee di costruzione visibili." },
    { name: "Matita", desc: "Schizzo architettonico professionale a matita, disegno a grafite." },
    { name: "Disegno Tecnico", desc: "Disegno tecnico a matita con quote, annotazioni e precisione millimetrica." },
    { name: "Schizzo", desc: "Disegno veloce a matita, tratti non finiti." },
    { name: "Olio su tela", desc: "Pennellate spesse, texture della stoffa visibile." },
    { name: "Pop Art", desc: "Stile Andy Warhol, colori primari, puntinato." },
    { name: "Pixel Art", desc: "Stile videogame anni '80/90." },
    { name: "Vettoriale", desc: "Grafica digitale pullita, loghi, illustrazioni moderne." },
    { name: "Iperrealista", desc: "Dettagli maniacali, porosità della pelle, riflessi perfetti." },
    { name: "Manga", desc: "Tratto giapponese, occhi grandi, dinamismo." },
    { name: "Inchiostro", desc: "Bianco e nero netto, stile calligrafico o illustrativo." },
    { name: "Steampunk", desc: "Mix di bronzo, ingranaggi e tecnologia a vapore." },
    { name: "Ukiyo-e", desc: "Lo stile delle antiche stampe su legno giapponesi." },
    { name: "Carboncino", desc: "Sfumature di grigio sporche e intense." },
    { name: "Espressionista", desc: "Colori distorti per esprimere emozioni forti." },
    { name: "Gotico", desc: "Architettura a punta, decorazioni elaborate, stile dark." },
    { name: "Street Art", desc: "Stile graffiti, spray, muri di mattoni." },
    { name: "Trasparente", desc: "Soggetto isolato con sfondo trasparente (canale alpha)." },
  ],
  Atmosfera: [
    { name: "No-AI", desc: "Genera un’immagine che non sembra generata dall’AI" },
    { name: "Cinematografico", desc: "Crea un'illuminazione da film, con ombre profonde e alta qualità." },
    { name: "Epico", desc: "Ideale per paesaggi vasti, battaglie o soggetti maestosi." },
    { name: "Etereo", desc: "Per immagini leggere, soffuse, quasi divine o spettrali." },
    { name: "Malinconico", desc: "Colori freddi, desaturati e un senso di solitudine." },
    { name: "Nostalgico", desc: "Effetto vecchia foto, ricordi d'infanzia, colori caldi." },
    { name: "Onirico", desc: "Atmosfera da sogno, dove le leggi della fisica sembrano sospese." },
    { name: "Cyberpunk", desc: "Luci al neon, pioggia notturna, contrasto tra viola e ciano." },
    { name: "Post-apocalittico", desc: "Senso di abbandono, rovine, natura che si riprende le città." },
    { name: "Zen", desc: "Minimalismo, calma, spazi vuoti e luce naturale." },
    { name: "Fiabesco", desc: "Colore pastello, foreste magiche, creature incantate." },
    { name: "Inquietante", desc: "Luci d'urto, ombre lunghe, senso di pericolo imminente." },
    { name: "Vibrante", desc: "Colori esplosivi, saturi, pieni di energia." },
    { name: "Intimo", desc: "Primi piani, luce soffusa, sensazione di vicinanza." },
    { name: "Surreale", desc: "Elementi assurdi accostati in modo realistico." },
    { name: "Vintage", desc: "Stile anni '50-'70, grana della pellicola, colori sbiaditi." },
    { name: "Tetro", desc: "Atmosfera pesante, nebbia, toni scuri e misteriosi." },
    { name: "Luminoso", desc: "Immagini piene di luce, solari, positive." },
  ]
};

// --- SVGs for Toolbar ---
const IconLeft = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h10M4 18h16" /></svg>;
const IconCenter = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M7 12h10M4 18h16" /></svg>;
const IconRight = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M10 12h10M4 18h16" /></svg>;
const IconJustify = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16" /></svg>;
const IconPipette = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7l3 3m0 0l3 3m-3-3l3-3m-3 3l-3 3" /></svg>;
const IconColor = () => (
  <div className="w-4 h-4 flex flex-col border border-slate-300 rounded-sm overflow-hidden">
    <div className="flex-1 bg-green-500"></div>
    <div className="flex-1 bg-red-500"></div>
    <div className="flex-1 bg-blue-500"></div>
  </div>
);
const IconImage = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const IconMagic = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;

const RichTextEditor: React.FC<{ 
    initialValue: string; 
    onChange: (val: string) => void;
    onImageUpload?: () => void;
    onGenerateMeta?: (text: string) => void;
    isGeneratingMeta?: boolean;
}> = ({ initialValue, onChange, onImageUpload, onGenerateMeta, isGeneratingMeta }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const [fontSize, setFontSize] = useState(14); 
    const [isColorOpen, setIsColorOpen] = useState(false);
    const colorInputRef = useRef<HTMLInputElement>(null);
    const [activeStyles, setActiveStyles] = useState<{ [key: string]: boolean }>({
        alignJustify: true
    });

    useEffect(() => {
        if (editorRef.current && editorRef.current.innerHTML !== initialValue) {
            if (document.activeElement !== editorRef.current) {
                editorRef.current.innerHTML = initialValue;
            }
        }
    }, [initialValue]);

    const checkActiveStyles = useCallback(() => {
        if (!editorRef.current) return;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        if (!editorRef.current.contains(selection.anchorNode)) {
          setActiveStyles({ alignJustify: true });
          return;
        }

        const styles = {
            bold: document.queryCommandState('bold'),
            italic: document.queryCommandState('italic'),
            underline: document.queryCommandState('underline'),
            alignLeft: document.queryCommandState('justifyLeft'),
            alignCenter: document.queryCommandState('justifyCenter'),
            alignRight: document.queryCommandState('justifyRight'),
            alignJustify: document.queryCommandState('justifyFull')
        };

        if (!styles.alignLeft && !styles.alignCenter && !styles.alignRight && !styles.alignJustify) {
            styles.alignJustify = true;
        }

        setActiveStyles(styles);
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const handleEvents = () => checkActiveStyles();
        document.addEventListener('selectionchange', handleEvents);
        editor.addEventListener('mouseup', handleEvents);
        editor.addEventListener('keyup', handleEvents);
        return () => {
            document.removeEventListener('selectionchange', handleEvents);
            editor.removeEventListener('mouseup', handleEvents);
            editor.removeEventListener('keyup', handleEvents);
        };
    }, [checkActiveStyles]);

    const execCommand = (command: string, value?: string) => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand(command, false, value);
        onChange(editorRef.current.innerHTML);
        checkActiveStyles();
    };

    const applyFontSize = (size: number) => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        
        if (!editorRef.current) return;
        editorRef.current.focus();

        if (selection.isCollapsed) return;

        document.execCommand('styleWithCSS', false, 'false');
        document.execCommand('fontSize', false, '1');
        
        const fonts = editorRef.current.querySelectorAll('font[size="1"]');
        if (fonts.length > 0) {
            fonts.forEach(f => {
                const span = document.createElement('span');
                span.style.fontSize = `${size}px`;
                span.innerHTML = f.innerHTML;
                f.parentNode?.replaceChild(span, f);
            });

            const newSel = window.getSelection();
            if (newSel) {
                const updatedRange = document.createRange();
                const parentNodes = editorRef.current.querySelectorAll('span[style*="font-size: ' + size + 'px"]');
                if (parentNodes.length > 0) {
                    updatedRange.setStartBefore(parentNodes[0]);
                    updatedRange.setEndAfter(parentNodes[parentNodes.length - 1]);
                    newSel.removeAllRanges();
                    newSel.addRange(updatedRange);
                }
            }
        }

        onChange(editorRef.current.innerHTML);
        checkActiveStyles();
    };

    const handleFontSizeChange = (delta: number) => {
        const newSize = Math.max(8, Math.min(100, fontSize + delta));
        applyFontSize(newSize);
        setFontSize(newSize);
    };

    const handlePipette = async () => {
        if (!('EyeDropper' in window)) {
            alert("Pipetta non supportata in questo browser.");
            return;
        }
        try {
            const eyeDropper = new (window as any).EyeDropper();
            const result = await eyeDropper.open();
            execCommand('foreColor', result.sRGBHex);
            setIsColorOpen(false);
        } catch (e) {
            console.warn("User cancelled eyedropper");
        }
    };

    const PRESET_COLORS = ["#000000", "#ffffff", "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#6366f1", "#8b5cf6", "#ec4899"];

    const toolbarBtnClass = (isActive: boolean) => 
        `px-2 py-1 flex items-center justify-center rounded border text-[10px] font-black shadow-sm transition-all h-8 min-w-[32px] uppercase active:scale-95 ${
            isActive ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600'
        }`;

    return (
        <div className="flex flex-col w-full border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-inner focus-within:ring-4 ring-indigo-500/5 transition-all">
            <div className="flex flex-wrap items-center gap-1 p-2 bg-slate-100 border-b border-slate-200 select-none">
                <div className="flex gap-1 mr-1">
                  <button onMouseDown={(e) => { e.preventDefault(); execCommand('bold'); }} className={toolbarBtnClass(activeStyles.bold)} title="Grassetto">B</button>
                  <button onMouseDown={(e) => { e.preventDefault(); execCommand('italic'); }} className={`${toolbarBtnClass(activeStyles.italic)} italic`} title="Corsivo">I</button>
                  <button onMouseDown={(e) => { e.preventDefault(); execCommand('underline'); }} className={`${toolbarBtnClass(activeStyles.underline)} underline`} title="Sottolineato">U</button>
                </div>

                <div className="w-px h-6 bg-slate-300 mx-1"></div>

                <div className="relative">
                    <button 
                        onMouseDown={(e) => { e.preventDefault(); setIsColorOpen(!isColorOpen); }} 
                        className={toolbarBtnClass(isColorOpen)} 
                        title="Colore Testo"
                    >
                        <IconColor />
                    </button>
                    {isColorOpen && (
                        <div className="absolute top-10 left-0 z-[100] bg-white border border-slate-200 shadow-2xl p-3 rounded-xl flex flex-col gap-3 min-w-[160px] animate-in fade-in zoom-in-95">
                            <div className="grid grid-cols-5 gap-1.5">
                                {PRESET_COLORS.map(c => (
                                    <button 
                                        key={c} 
                                        onMouseDown={(e) => { e.preventDefault(); execCommand('foreColor', c); setIsColorOpen(false); }} 
                                        className="w-6 h-6 rounded-md border border-slate-200 shadow-sm transition-transform hover:scale-110"
                                        style={{backgroundColor: c}}
                                    />
                                ))}
                                <button 
                                    onMouseDown={(e) => { e.preventDefault(); colorInputRef.current?.click(); }} 
                                    className="w-6 h-6 rounded-md border border-slate-200 flex items-center justify-center text-xs font-bold hover:bg-slate-50"
                                    title="Più colori"
                                >+</button>
                            </div>
                            <div className="h-px bg-slate-100"></div>
                            <button 
                                onMouseDown={(e) => { e.preventDefault(); handlePipette(); }}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-all"
                            >
                                <IconPipette /> Pipetta Colore
                            </button>
                            <input 
                                type="color" 
                                ref={colorInputRef} 
                                className="invisible absolute pointer-events-none" 
                                onChange={(e) => { execCommand('foreColor', e.target.value); setIsColorOpen(false); }} 
                            />
                        </div>
                    )}
                </div>

                <div className="w-px h-6 bg-slate-300 mx-1"></div>

                <select 
                    onChange={(e) => execCommand('fontName', e.target.value)}
                    className="h-8 px-2 text-[10px] font-black uppercase bg-white border border-slate-200 rounded outline-none focus:ring-2 ring-indigo-500/20 mr-1"
                    defaultValue="'Open Sans', sans-serif"
                >
                    <option value="'Open Sans', sans-serif">Open Sans (DEFAULT)</option>
                    <option value="'Montserrat', sans-serif">Montserrat</option>
                    <option value="'Anton', sans-serif">Anton</option>
                    <option value="Arial, sans-serif">Arial</option>
                    <option value="Georgia, serif">Georgia</option>
                    <option value="'Courier New', monospace">Courier</option>
                </select>

                <div className="w-px h-6 bg-slate-300 mx-1"></div>

                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-1 h-8">
                  <button onMouseDown={(e) => { e.preventDefault(); handleFontSizeChange(-1); }} className="w-6 h-6 flex items-center justify-center hover:bg-slate-100 rounded text-xs font-black transition-colors" title="Diminuisci">-</button>
                  <div className="px-2 text-[10px] font-black border-x border-slate-100 min-w-[42px] text-center select-none text-indigo-600">{fontSize}px</div>
                  <button onMouseDown={(e) => { e.preventDefault(); handleFontSizeChange(1); }} className="w-6 h-6 flex items-center justify-center hover:bg-slate-100 rounded text-xs font-black transition-colors" title="Aumenta">+</button>
                </div>

                <div className="w-px h-6 bg-slate-300 mx-1"></div>

                <div className="flex gap-1">
                  <button onMouseDown={(e) => { e.preventDefault(); execCommand('justifyLeft'); }} className={toolbarBtnClass(activeStyles.alignLeft)} title="Sinistra"><IconLeft /></button>
                  <button onMouseDown={(e) => { e.preventDefault(); execCenter(e) }} className={toolbarBtnClass(activeStyles.alignCenter)} title="Centro"><IconCenter /></button>
                  <button onMouseDown={(e) => { e.preventDefault(); execCommand('justifyRight'); }} className={toolbarBtnClass(activeStyles.alignRight)} title="Destra"><IconRight /></button>
                  <button onMouseDown={(e) => { e.preventDefault(); execCommand('justifyFull'); }} className={toolbarBtnClass(activeStyles.alignJustify)} title="Giustificato"><IconJustify /></button>
                </div>

                <div className="w-px h-6 bg-slate-300 mx-1"></div>

                <button 
                  onMouseDown={(e) => { e.preventDefault(); onImageUpload?.(); }} 
                  className={toolbarBtnClass(false)} 
                  title="Aggiungi Immagine"
                >
                  <IconImage />
                </button>

                {onGenerateMeta && (
                  <button 
                    onMouseDown={(e) => { 
                      e.preventDefault(); 
                      const text = editorRef.current?.innerText || "";
                      onGenerateMeta(text); 
                    }} 
                    disabled={isGeneratingMeta}
                    className={`${toolbarBtnClass(false)} ${isGeneratingMeta ? 'animate-pulse bg-indigo-50 text-indigo-400' : 'text-indigo-600 border-indigo-100 hover:bg-indigo-600 hover:text-white'}`} 
                    title="Genera nuovo sottotitolo e parole chiave"
                  >
                    <IconMagic />
                  </button>
                )}
            </div>
            <div 
                ref={editorRef}
                contentEditable
                className="w-full h-80 p-6 bg-white outline-none text-[14px] leading-relaxed overflow-y-auto min-h-[20rem] transition-colors text-justify"
                onInput={(e) => onChange(e.currentTarget.innerHTML)}
                onBlur={(e) => onChange(e.currentTarget.innerHTML)}
                style={{ textAlign: 'justify', textJustify: 'inter-word' }}
            />
        </div>
    );

    function execCenter(e: React.MouseEvent) {
        e.preventDefault();
        execCommand('justifyCenter');
    }
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1]);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const App: React.FC = () => {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Caricamento...");
  const [isWidePreview, setIsWidePreview] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userPreviewZoom, setUserPreviewZoom] = useState(1);
  const [paletteToDelete, setPaletteToDelete] = useState<string | null>(null);
  const [isDeletingCover, setIsDeletingCover] = useState(false);
  const [isAddingPaletteUI, setIsAddingPaletteUI] = useState(false);
  const [newPaletteName, setNewPaletteName] = useState("");
  const [autoSaveInterval, setAutoSaveInterval] = useState<number>(2);
  const [defaultAuthor, setDefaultAuthor] = useState<string>("Teatro dell'Argine");
  const [filenamePrefix, setFilenamePrefix] = useState<string>("Dossier_");
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [globalPalettes, setGlobalPalettes] = useState<any[]>(PALETTES);

  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

  // Load settings from IndexedDB (more reliable than localStorage in some environments)
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedInterval = await getFromDB("settings", "autoSaveInterval");
        if (savedInterval !== undefined) setAutoSaveInterval(savedInterval as number);
        
        const savedAuthor = await getFromDB("settings", "defaultAuthor");
        if (savedAuthor !== undefined) setDefaultAuthor(savedAuthor as string);
        
        const savedPrefix = await getFromDB("settings", "filenamePrefix");
        if (savedPrefix !== undefined) setFilenamePrefix(savedPrefix as string);
        
        const savedDarkMode = await getFromDB("settings", "isDarkMode");
        if (savedDarkMode !== undefined) setIsDarkMode(savedDarkMode as boolean);

        const savedPalettes = await getFromDB("settings", "globalPalettes");
        if (savedPalettes !== undefined) {
          setGlobalPalettes(savedPalettes as any[]);
          // Also update current project palettes if they are default
          setState(prev => {
            if (!prev.palettes || JSON.stringify(prev.palettes) === JSON.stringify(PALETTES)) {
              return { ...prev, palettes: savedPalettes as any[] };
            }
            return prev;
          });
        }

        const savedContacts = await getFromDB("settings", "recentContacts");
        if (savedContacts !== undefined && Array.isArray(savedContacts) && savedContacts.length > 0) {
          setRecentContacts(savedContacts as Contact[]);
        }
      } catch (e) {
        console.error("Failed to load settings from DB", e);
        // Fallback to localStorage
        const lsInterval = localStorage.getItem('tda_autosave_interval');
        if (lsInterval) setAutoSaveInterval(parseInt(lsInterval));
        
        const lsAuthor = localStorage.getItem('tda_default_author');
        if (lsAuthor) setDefaultAuthor(lsAuthor);
        
        const lsPrefix = localStorage.getItem('tda_filename_prefix');
        if (lsPrefix) setFilenamePrefix(lsPrefix);
        
        const lsDarkMode = localStorage.getItem('tda_dark_mode');
        if (lsDarkMode) setIsDarkMode(lsDarkMode === 'true');
      } finally {
        setIsSettingsLoaded(true);
      }
    };
    loadSettings();
  }, []);
  
  const currentStep = state.currentStep || Step.Selection;
  const setCurrentStep = (step: Step) => setState(prev => ({ ...prev, currentStep: step }));
  const inputText = state.inputText || "";
  const setInputText = (text: string | ((prev: string) => string)) => {
    setState(prev => ({
      ...prev,
      inputText: typeof text === 'function' ? text(prev.inputText || "") : text
    }));
  };
  const uploadedFileNames = state.uploadedFileNames || [];
  const setUploadedFileNames = (updater: string[] | ((prev: string[]) => string[])) => {
    setState(prev => {
      const newNames = typeof updater === 'function' ? updater(prev.uploadedFileNames || []) : updater;
      return { ...prev, uploadedFileNames: newNames };
    });
  };
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const chapterImageInputRef = useRef<HTMLInputElement>(null);
  const activeChapterIndexForImage = useRef<number | null>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const [isAddingPage, setIsAddingPage] = useState(false);
  const [generatingMetaForChapterId, setGeneratingMetaForChapterId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const saveToRecentContacts = (contact: Contact) => {
    if (!contact.name.trim()) return;
    setRecentContacts(prev => {
      // Check if already exists (by name and email)
      const filtered = prev.filter(c => !(c.name === contact.name && c.email === contact.email));
      const contactToSave = { name: contact.name, email: contact.email, phone: contact.phone, role: contact.role };
      const newList = [contactToSave, ...filtered].slice(0, 20); // Keep last 20, move to top
      return newList;
    });
    showToast("Contatto salvato nei preferiti", "success");
  };

  const addFromRecent = (contact: Contact) => {
    setState(s => ({
      ...s,
      contacts: [...s.contacts, contact]
    }));
  };

  const removeFromRecentContacts = (index: number) => {
    setRecentContacts(prev => {
      const newList = prev.filter((_, i) => i !== index);
      return newList;
    });
  };

  // --- PERSISTENCE & HISTORY LOGIC ---
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [recentContacts, setRecentContacts] = useState<Contact[]>([]);
  const [isRecentContactsOpen, setIsRecentContactsOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [palettePage, setPalettePage] = useState(0);
  const [favoritesItems, setFavoritesItems] = useState<any[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const favoritesScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSettingsLoaded) return;
    saveToDB("settings", "autoSaveInterval", autoSaveInterval);
    localStorage.setItem('tda_autosave_interval', autoSaveInterval.toString());
  }, [autoSaveInterval, isSettingsLoaded]);

  useEffect(() => {
    if (!isSettingsLoaded) return;
    saveToDB("settings", "defaultAuthor", defaultAuthor);
    localStorage.setItem('tda_default_author', defaultAuthor);
  }, [defaultAuthor, isSettingsLoaded]);

  useEffect(() => {
    if (!isSettingsLoaded) return;
    saveToDB("settings", "filenamePrefix", filenamePrefix);
    localStorage.setItem('tda_filename_prefix', filenamePrefix);
  }, [filenamePrefix, isSettingsLoaded]);

  useEffect(() => {
    if (!isSettingsLoaded) return;
    saveToDB("settings", "isDarkMode", isDarkMode);
    localStorage.setItem('tda_dark_mode', isDarkMode.toString());
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode, isSettingsLoaded]);

  useEffect(() => {
    if (!isSettingsLoaded) return;
    saveToDB("settings", "recentContacts", recentContacts);
  }, [recentContacts, isSettingsLoaded]);

  useEffect(() => {
    if (!isSettingsLoaded) return;
    saveToDB("settings", "globalPalettes", globalPalettes);
  }, [globalPalettes, isSettingsLoaded]);

  const handleFavoritesScroll = () => {
    if (favoritesScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = favoritesScrollRef.current;
      // Only consider it having "more" if the scrollable height is significantly larger than visible height
      // This avoids triggering for a few pixels of padding or sub-pixel rendering issues
      const hasMore = scrollHeight > clientHeight + 10;
      // We are at bottom if scrollTop + clientHeight is close to scrollHeight
      const atBottom = scrollTop + clientHeight >= scrollHeight - 40;
      setIsAtBottom(!hasMore || atBottom);
    }
  };

  useEffect(() => {
    if (isFavoritesOpen) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(handleFavoritesScroll, 150);
      return () => clearTimeout(timer);
    }
  }, [isFavoritesOpen, favoritesItems]);

  const loadFavorites = useCallback(async () => {
    try {
      const items = await getAllFromDB("favorites");
      setFavoritesItems(items.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) {
      console.error("Error loading favorites", e);
    }
  }, []);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const addToFavorites = async (imageData: string) => {
    if (!imageData) return;
    
    try {
      const currentItems = await getAllFromDB("favorites");
      if (currentItems.length >= 20) {
        // Find oldest item
        const sorted = currentItems.sort((a, b) => a.timestamp - b.timestamp);
        const oldest = sorted[0];
        await removeFromDB("favorites", oldest.id);
      }

      const id = `fav-${Date.now()}`;
      const favorite = {
        id,
        timestamp: Date.now(),
        image: imageData,
        subject: state.coverSubject,
        style: state.coverStyle
      };
      
      await saveToDB("favorites", null, favorite);
      await loadFavorites();
      showToast("Immagine aggiunta ai preferiti", "success");
    } catch (e) {
      console.error("Error saving favorite", e);
      showToast("Errore nel salvataggio", "error");
    }
  };

  const removeFromFavorites = async (id: string) => {
    try {
      await removeFromDB("favorites", id);
      await loadFavorites();
      showToast("Immagine rimossa dai preferiti", "success");
    } catch (e) {
      console.error("Error removing favorite", e);
    }
  };

  const useFavoriteAsCover = (imageData: string) => {
    setState(s => ({
      ...s,
      coverImage: imageData,
      isCoverImageAiGenerated: true,
      coverZoom: 100,
      coverPosition: { x: 50, y: 50 }
    }));
    setIsFavoritesOpen(false);
    showToast("Immagine caricata come copertina", "success");
  };
  const [isFloatingZoomOpen, setIsFloatingZoomOpen] = useState(false);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const [confirmDeleteFavoriteId, setConfirmDeleteFavoriteId] = useState<string | null>(null);
  const [contactToDelete, setContactToDelete] = useState<number | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedHistoryProject, setSelectedHistoryProject] = useState<string | null>(null);
  const [confirmingLoadTimestamp, setConfirmingLoadTimestamp] = useState<number | null>(null);
  const [confirmingDeleteTimestamp, setConfirmingDeleteTimestamp] = useState<number | null>(null);
  const [confirmDeleteFileIndex, setConfirmDeleteFileIndex] = useState<number | null>(null);
  
  const stateRef = useRef(state);
  const lastSnapshotRef = useRef<string>("");
  const lastHistorySnapshotRef = useRef<string>("");

  // Keep ref in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 1. Initial Load
  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const saved = await getFromDB("projects", STORAGE_KEY);
        if (saved) {
          // We found a saved session. 
          // If the user is at the very beginning, we can either auto-resume 
          // or just enable the "Prosegui" button.
          // The user said "voglio ritrovare il lavoro lì", so let's auto-resume 
          // if they were beyond the selection step.
          const savedState = saved as AppState;
          setHasSavedSession(true);
          
          // Merge with DEFAULT_STATE to ensure new properties are present
          const mergedState = { ...DEFAULT_STATE, ...savedState };
          
          if (mergedState.currentStep !== Step.Selection) {
            setState(mergedState);
            lastSnapshotRef.current = JSON.stringify(mergedState);
            lastHistorySnapshotRef.current = JSON.stringify(mergedState);
          } else {
            // Just update the data but stay at Selection
            setState(mergedState);
            lastSnapshotRef.current = JSON.stringify(mergedState);
            lastHistorySnapshotRef.current = JSON.stringify(mergedState);
          }
        } else {
          const legacy = localStorage.getItem(STORAGE_KEY);
          if (legacy) {
            const parsed = JSON.parse(legacy);
            setHasSavedSession(true);
            const mergedLegacy = { ...DEFAULT_STATE, ...parsed };
            if (mergedLegacy.currentStep !== Step.Selection) {
              setState(mergedLegacy);
            } else {
              setState(mergedLegacy);
            }
            await saveToDB("projects", STORAGE_KEY, mergedLegacy);
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (e) {
        console.error("Error loading initial state", e);
      }
    };
    loadInitialState();
  }, []);

  // 2. Continuous Auto-save (Project Store)
  useEffect(() => {
    const autoSave = async () => {
      const stateString = JSON.stringify(state);
      // Only save if the state has actually changed from what we last saved
      if (stateString === lastSnapshotRef.current) return;
      
      try {
        // Update lastUpdated timestamp in the state we save
        const stateToSave = { ...state, lastUpdated: Date.now() };
        await saveToDB("projects", STORAGE_KEY, stateToSave);
        lastSnapshotRef.current = stateString;
      } catch (e) {
        console.error("Auto-save failed", e);
      }
    };
    autoSave();
  }, [state]);

  // Warn before leaving if there's unsaved work (though we auto-save constantly)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Standard way to trigger a confirmation dialog
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // 3. Periodic History Snapshots (History Store) - CONFIGURABLE INTERVAL
  useEffect(() => {
    const interval = setInterval(async () => {
      if (document.hidden) return;
      
      const currentState = stateRef.current;
      
      // Only snapshot if there's actual content
      if (currentState.chapters.length > 0 || (currentState.title && currentState.title !== "TITOLO PROGETTO")) {
        try {
          const stateString = JSON.stringify(currentState);
          
          // DEDUPLICATION: Only save if state has changed since last snapshot
          if (stateString === lastHistorySnapshotRef.current) {
            console.log("Skipping auto-snapshot: no changes detected.");
            return;
          }

          const snapshot = {
            timestamp: Date.now(),
            state: JSON.parse(stateString), // Deep clone
            label: `Auto-snapshot - ${new Date().toLocaleTimeString()}`,
            projectTitle: currentState.title || 'Senza Titolo'
          };
          
          await saveToDB("history", null, snapshot);
          await deleteOldestHistoryForProject(currentState.title || 'Senza Titolo');
          
          lastHistorySnapshotRef.current = stateString; // Update last snapshot ref
          console.log(`Automatic snapshot saved at ${new Date().toLocaleTimeString()} (${autoSaveInterval} min interval)`);
        } catch (e) {
          console.error("Periodic snapshot failed", e);
        }
      }
    }, autoSaveInterval * 60 * 1000);
    return () => clearInterval(interval);
  }, [autoSaveInterval]); // Dependency on autoSaveInterval so it restarts when changed

  // 4. Manual Actions
  const createManualRestorePoint = async () => {
    try {
      const currentState = stateRef.current;
      const stateString = JSON.stringify(currentState);
      
      const snapshot = {
        timestamp: Date.now(),
        state: JSON.parse(stateString),
        label: `Backup Manuale - ${new Date().toLocaleTimeString()}`,
        projectTitle: currentState.title || 'Senza Titolo'
      };
      
      await saveToDB("history", null, snapshot);
      await deleteOldestHistoryForProject(currentState.title || 'Senza Titolo');
      
      lastHistorySnapshotRef.current = stateString; // Update last snapshot ref
      showToast("Punto di ripristino creato!");
      
      // Refresh history list
      const items = await getAllFromDB("history");
      setHistoryItems(items.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) {
      showToast("Errore creazione backup", "error");
    }
  };

  const openHistory = async () => {
    try {
      const items = await getAllFromDB("history");
      setHistoryItems(items.sort((a, b) => b.timestamp - a.timestamp));
      setSelectedHistoryProject(null);
      setIsHistoryModalOpen(true);
    } catch (e) {
      showToast("Errore caricamento cronologia", "error");
    }
  };

  const deleteHistoryItem = async (timestamp: number) => {
    try {
      await removeFromDB("history", timestamp as any);
      const items = await getAllFromDB("history");
      setHistoryItems(items.sort((a, b) => b.timestamp - a.timestamp));
      
      if (selectedHistoryProject) {
        const remainingForProject = items.filter((item: any) => (item.projectTitle || item.state?.title || 'Senza Titolo') === selectedHistoryProject);
        if (remainingForProject.length === 0) {
          setSelectedHistoryProject(null);
        }
      }
      
      showToast("Elemento eliminato");
    } catch (e) {
      showToast("Errore eliminazione", "error");
    }
  };

  const [showHistoryScrollArrow, setShowHistoryScrollArrow] = useState(false);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const [isConfirmingDeleteProject, setIsConfirmingDeleteProject] = useState(false);

  const deleteProjectHistory = async (projectTitle: string) => {
    try {
      const db = await dbPromise;
      const tx = db.transaction("history", "readwrite");
      const store = tx.objectStore("history");
      const request = store.getAll();
      
      request.onsuccess = async () => {
        const items = request.result;
        const itemsToDelete = items.filter((item: any) => (item.projectTitle || item.state?.title || 'Senza Titolo') === projectTitle);
        
        for (const item of itemsToDelete) {
          await removeFromDB("history", item.timestamp as any);
        }
        
        const updatedItems = await getAllFromDB("history");
        setHistoryItems(updatedItems.sort((a, b) => b.timestamp - a.timestamp));
        setSelectedHistoryProject(null);
        setIsConfirmingDeleteProject(false);
        showToast("Intera cronologia progetto eliminata");
      };
    } catch (e) {
      showToast("Errore eliminazione cronologia", "error");
    }
  };

  const checkHistoryScroll = () => {
    if (historyScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = historyScrollRef.current;
      // Show arrow if there's more than 20px to scroll down
      setShowHistoryScrollArrow(scrollHeight - scrollTop - clientHeight > 20);
    }
  };

  useEffect(() => {
    if (isHistoryModalOpen) {
      // Small timeout to wait for content to render
      const timer = setTimeout(checkHistoryScroll, 100);
      return () => clearTimeout(timer);
    } else {
      setShowHistoryScrollArrow(false);
      setIsConfirmingDeleteProject(false);
    }
  }, [isHistoryModalOpen, historyItems, selectedHistoryProject]);

  const loadHistoryItem = async (item: any) => {
    // Merge with DEFAULT_STATE to ensure compatibility with new features
    const mergedState = { ...DEFAULT_STATE, ...item.state };
    setState(mergedState);
    
    // Update refs to prevent immediate duplicate saves/snapshots
    const stateString = JSON.stringify(mergedState);
    lastSnapshotRef.current = stateString;
    lastHistorySnapshotRef.current = stateString;
    
    setIsHistoryModalOpen(false);
    setConfirmingLoadTimestamp(null);
    showToast("Versione ripristinata con successo!");
  };

  const downloadHistoryItem = (item: any) => {
    const blob = new Blob([JSON.stringify(item.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${item.label.replace(/\s+/g, '_')}_${item.timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("File JSON scaricato");
  };

  // Image Dragging State
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 50, posY: 50 });
  
  // PDF Export Settings
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [pdfQuality, setPdfQuality] = useState<'standard' | 'high'>('standard');
  const [pdfPageRange, setPdfPageRange] = useState<string>('all');

  const handleSelectLayout = (type: LayoutType) => {
    // Start fresh
    setState({ ...DEFAULT_STATE, layoutType: type });
    handleNext();
  };

  const handleResume = async () => {
    const saved = await getFromDB("projects", STORAGE_KEY);
    if (saved) {
      const savedState = saved as AppState;
      // Merge with DEFAULT_STATE
      const mergedState = { ...DEFAULT_STATE, ...savedState };
      setState(mergedState);
      // If they were at selection, move to setup, otherwise stay where they were
      if (mergedState.currentStep === Step.Selection) {
        handleNext();
      }
      showToast("Sessione ripristinata");
    } else {
      showToast("Nessuna sessione trovata", "error");
    }
  };

  const handleNext = () => {
    const steps = Object.values(Step);
    const nextIdx = steps.indexOf(currentStep) + 1;
    if (nextIdx < steps.length) {
      setCurrentStep(steps[nextIdx]);
      window.scrollTo(0, 0);
    }
  };

  const handleBack = () => {
    const steps = Object.values(Step);
    const prevIdx = steps.indexOf(currentStep) - 1;
    if (prevIdx >= 0) {
      setCurrentStep(steps[prevIdx]);
      window.scrollTo(0, 0);
    }
  };

  const goToStep = (step: Step) => {
    setCurrentStep(step);
    window.scrollTo(0, 0);
  };

  const handleSkipAI = () => {
    const timestamp = Date.now();
    const mockChapters: Chapter[] = [
      { id: `mock-1-${timestamp}`, title: 'COSA', subtitle: 'Descrizione sintetica del progetto teatrale', keywords: ['Teatro', 'Arte', 'Inclusione', 'Comunità'], content: MOCK_TEXT_1300 },
      { id: `mock-2-${timestamp}`, title: 'PER CHI', subtitle: 'Target e destinatari dell\'intervento', keywords: ['Giovani', 'Scuole', 'Territorio', 'Cittadini'], content: MOCK_TEXT_1300 },
      { id: `mock-3-${timestamp}`, title: 'PERCHÉ', subtitle: 'Obiettivi poetici e pedagogici', keywords: ['Poetica', 'Visione', 'Obiettivi', 'Impatto'], content: MOCK_TEXT_1300 },
      { id: `mock-4-${timestamp}`, title: 'QUANDO', subtitle: 'Cronoprogramma e fasi realizzative', keywords: ['Timeline', 'Fasi', 'Calendario', 'Eventi'], content: MOCK_TEXT_1300 },
      { id: `mock-5-${timestamp}`, title: 'QUANTO', subtitle: 'Dettaglio dei costi e piano economico', keywords: ['Budget', 'Costi', 'Sostenibilità', 'Risorse'], content: MOCK_TEXT_1300 },
      { id: `mock-6-${timestamp}`, title: 'CHI SIAMO', subtitle: 'Compagnia Teatro dell\'Argine', keywords: ["Arte", "Comunità", "Progetti", "Bellezza"], content: CURRICULUM_TDA },
      { id: `chapter-contacts-${timestamp}`, title: 'CONTATTI', subtitle: 'Per ulteriori informazioni e collaborazioni', keywords: ['Sede', 'Email', 'Telefono', 'Sito Web'], content: '' },
      { id: `chapter-thanks-${timestamp}`, title: 'GRAZIE', subtitle: '', keywords: [], content: '' }
    ];

    setState(s => ({ ...s, chapters: mockChapters.map(c => ({...c, image: null, imageZoom: 100, imagePosition: { x: 50, y: 50 } })) }));
    setCurrentStep(Step.Setup);
    window.scrollTo(0, 0);
  };

  const handleAIAnalysis = async () => {
    if (!inputText.trim()) return;
    setLoadingMessage("L'AI sta analizzando i tuoi testi...");
    setLoading(true);
    try {
      const { 
        chapters: aiChapters, 
        suggestedTitle, 
        suggestedSubtitle,
        suggestedImageSubject,
        suggestedImageStyle
      } = await withTimeout(
        analyzeContent(inputText),
        120000,
        "L'analisi dei testi sta impiegando troppo tempo. Riprova con un testo più breve o controlla la connessione."
      );
      const timestamp = Date.now();
      const contactsChapter: Chapter = { id: `chapter-contacts-${timestamp}`, title: 'CONTATTI', subtitle: 'Per ulteriori informazioni e collaborazioni', keywords: ['Sede', 'Email', 'Telefono', 'Sito Web'], content: '', image: null, imageZoom: 100, imagePosition: { x: 50, y: 50 } };
      const grazieChapter: Chapter = { id: `chapter-thanks-${timestamp}`, title: 'GRAZIE', subtitle: '', keywords: [], content: '', image: null, imageZoom: 100, imagePosition: { x: 50, y: 50 } };
      
      setState(s => ({ 
        ...s, 
        title: suggestedTitle || s.title,
        subtitle: suggestedSubtitle || s.subtitle,
        coverSubject: `Il Soggetto: ${suggestedImageSubject || s.coverSubject}\nLo Stile: ${suggestedImageStyle || s.coverStyle}`,
        coverStyle: suggestedImageStyle || s.coverStyle,
        chapters: [...aiChapters.map(c => ({...c, image: null, imageZoom: 100, imagePosition: { x: 50, y: 50 }})), contactsChapter, grazieChapter] 
      }));

      // Auto-generate cover image based on AI suggestions
      setLoadingMessage("Generazione immagine di copertina suggerita...");
      try {
        const img = await withTimeout(
          generateCoverImage(suggestedTitle, suggestedImageSubject, suggestedImageStyle, "4:3"),
          120000,
          "La generazione dell'immagine sta impiegando troppo tempo."
        );
        setState(s => ({ ...s, coverImage: img, isCoverImageAiGenerated: true, coverZoom: 100, coverPosition: { x: 50, y: 50 } }));
      } catch (imgErr) {
        console.error("Auto image generation failed", imgErr);
        // We don't block the whole process if image generation fails
      }
      
      setCurrentStep(Step.Setup);
      window.scrollTo(0, 0);
    } catch (e: any) { 
        console.error(e);
        showToast("Errore analisi AI. Riprova.", "error"); 
    } finally {
        setLoading(false);
    }
  };

  const handleAIGenImage = async () => {
    if (!state.coverSubject.trim()) {
      showToast("Inserisci un sognato visivo desiderato.", "error");
      return;
    }
    setLoadingMessage(state.coverImage ? "Modifica immagine in corso..." : "Generazione immagine di copertina in corso...");
    setLoading(true);
    try {
      const selectedStyles = state.coverStyle.split(', ').filter(s => s);
      let finalStyle = state.coverStyle;
      let finalAspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" = "4:3";

      if (selectedStyles.includes("No-AI")) {
          const noAiTechnicalPrompt = "fotografia candid shot, scattata con 35mm, pellicola Fujifilm, grana della pellicola visibile, illuminazione naturale non filtrata, leggera prima aberrazione cromatica, profondità di campo naturale, micro-dettagli della pelle, texture reali, imperfezioni ambientali, leggermente fuori fuoco, stile amatoriale --no 3d render, plastic, smooth skin, symmetrical, cartoonish";
          finalStyle = finalStyle.replace("No-AI", "").trim();
          finalStyle = `${finalStyle}, ${noAiTechnicalPrompt}`.trim();
      }

      if (selectedStyles.includes("Matita light")) {
          const matitaLightPrompt = "Minimalist freehand pencil sketch, light and rough graphite strokes. ONLY thin outlines, NO fills, NO white areas, NO background. Pure line art on a neutral background. Preparatory academic drawing style, perspective construction lines. --no color, shading, chiaroscuro, 3d render, photo, realistic, gradient, white fills, background, solid surfaces, paper texture";
          finalStyle = finalStyle.replace("Matita light", "").trim();
          finalStyle = `${finalStyle}, ${matitaLightPrompt}`.trim();
          finalAspectRatio = "16:9";
      }

      if (selectedStyles.includes("Matita a mano libera")) {
          const matitaLiberaPrompt = "Minimalist gestural freehand pencil sketch on white paper. Focus on contour lines and silhouette. Rapid, loose graphite strokes of varying thickness suggesting movement and form. No complex shading or chiaroscuro. Fashion sketch or rapid anatomical study style. Fresh, essential, elegant, and immediate lines. Overlapping and slightly irregular strokes, authentic hand-drawn live character. --no color, shading, chiaroscuro, 3d render, photo, realistic, gradient, white fills, background, solid surfaces, paper texture";
          finalStyle = finalStyle.replace("Matita a mano libera", "").trim();
          finalStyle = `${finalStyle}, ${matitaLiberaPrompt}`.trim();
          finalAspectRatio = "16:9";
      }

      if (selectedStyles.includes("Matita")) {
          const matitaPrompt = "Professional architectural pencil sketch, high contrast graphite lines. ONLY strokes and lines, NO fills, NO white surfaces, NO background. Pure line art on a neutral background. Technical drawing aesthetic, artistic hand-drawn lines, rough shading only via crosshatching. --no color, realistic photo, 3d render, glossy, blurry, white fills, background, solid surfaces, paper texture";
          finalStyle = finalStyle.replace("Matita", "").trim();
          finalStyle = `${finalStyle}, ${matitaPrompt}`.trim();
          finalAspectRatio = "16:9";
      }

      if (selectedStyles.includes("Disegno Tecnico")) {
          const tecnicoPrompt = "Professional technical blueprint drawing, pencil sketch on drafting paper. Includes dimension lines, technical annotations, measurements, and geometric callouts. All text and labels must be in Italian. Clean orthographic projection, architectural drafting style, monochromatic graphite, high precision, ruler-straight lines mixed with hand-drawn technical feel. --no color, photo, 3d render, artistic blur, messy shading, text (except technical labels in Italian), watermark";
          finalStyle = finalStyle.replace("Disegno Tecnico", "").trim();
          finalStyle = `${finalStyle}, ${tecnicoPrompt}`.trim();
          finalAspectRatio = "16:9";
      }
      
      let img = await withTimeout(
        generateCoverImage(state.title, state.coverSubject, finalStyle, finalAspectRatio, state.coverImage || undefined),
        120000,
        "La generazione dell'immagine sta impiegando troppo tempo. Riprova tra poco."
      );

      if (selectedStyles.includes("Trasparente")) {
        setLoadingMessage("Rimozione sfondo in corso...");
        try {
          if (selectedStyles.includes("Matita") || selectedStyles.includes("Matita light") || selectedStyles.includes("Matita a mano libera") || selectedStyles.includes("Disegno Tecnico")) {
            // For pencil sketches, convert white to transparent (luminance to alpha)
            // This ensures white fills inside the subject are also removed
            img = await makeWhiteTransparent(img);
          } else {
            // Standard background removal for other styles
            const blob = await removeBackground(img);
            const reader = new FileReader();
            img = await new Promise<string>((resolve, reject) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
        } catch (bgError) {
          console.error("Background removal failed:", bgError);
          // Fallback to original image if background removal fails
        }
      }

      setState(s => ({ ...s, coverImage: img, isCoverImageAiGenerated: true, coverZoom: 100, coverPosition: { x: 50, y: 50 } }));
    } catch (e: any) { 
        console.error(e);
        alert(e.message || "Errore generazione immagine"); 
    } finally {
        setLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLoadingMessage("Elaborazione immagine...");
      setLoading(true);
      try {
        const resizedImage = await processAndResizeImage(file);
        setState(prev => ({ 
          ...prev, 
          coverImage: resizedImage, 
          isCoverImageAiGenerated: false, 
          coverZoom: 100, 
          coverPosition: { x: 50, y: 50 } 
        }));
      } catch (err) {
        console.error("Image processing error", err);
        alert("Errore durante l'elaborazione dell'immagine.");
      } finally {
        setLoading(false);
        if (e.target) {
          e.target.value = "";
        }
      }
    }
  };

  const handleChapterImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const index = activeChapterIndexForImage.current;
    if (file && index !== null) {
      setLoadingMessage("Elaborazione immagine...");
      setLoading(true);
      try {
        const resizedImage = await processAndResizeImage(file);
        setState(prev => {
          const newChapters = [...prev.chapters];
          if (index >= 0 && index < newChapters.length) {
            newChapters[index] = {
              ...newChapters[index],
              image: resizedImage,
              imageZoom: 100,
              imagePosition: { x: 50, y: 50 }
            };
          }
          return { ...prev, chapters: newChapters };
        });
      } catch (err) {
        console.error("Image processing error", err);
        alert("Errore durante l'elaborazione dell'immagine.");
      } finally {
        setLoading(false);
      }
    }
    if (chapterImageInputRef.current) chapterImageInputRef.current.value = "";
  };

  const handleImageMouseDown = (e: React.MouseEvent) => {
    if (currentStep !== Step.Setup) return;
    setIsDragging(true);
    dragStart.current = { 
      x: e.clientX, 
      y: e.clientY, 
      posX: state.coverPosition.x, 
      posY: state.coverPosition.y 
    };
  };

  const handleImageMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    
    const deltaX = (e.clientX - dragStart.current.x) / 10;
    const deltaY = (e.clientY - dragStart.current.y) / 10;
    
    setState(prev => ({
      ...prev,
      coverPosition: {
        x: Math.max(0, Math.min(100, dragStart.current.posX - deltaX)),
        y: Math.max(0, Math.min(100, dragStart.current.posY - deltaY))
      }
    }));
  };

  const handleImageMouseUp = () => {
    setIsDragging(false);
  };

  const resetCover = () => {
    setState(prev => ({
      ...prev,
      coverZoom: 100,
      coverPosition: { x: 50, y: 50 }
    }));
  };

  const processFile = async (file: File): Promise<string> => {
    if (file.type.startsWith("audio/")) {
      const base64 = await blobToBase64(file);
      const cleanMimeType = file.type.split(';')[0];
      return await transcribeAudio(base64, cleanMimeType);
    } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } else if (file.type === "application/pdf") {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.mjs';
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => (item as any).str).join(" ");
        fullText += pageText + "\n";
      }
      return fullText;
    } else {
      return await file.text();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Setup audio context for visualization
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        setAudioLevel(average);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const mimeType = audioChunksRef.current[0]?.type || 'audio/webm';
        const cleanMimeType = mimeType.split(';')[0]; // Rimuove eventuali codec che potrebbero far fallire l'API di Gemini
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const base64 = await blobToBase64(audioBlob);
        
        setLoadingMessage("Trascrizione audio in corso...");
        setLoading(true);
        try {
          const text = await transcribeAudio(base64, cleanMimeType);
          const now = new Date();
          const fileName = `Registrazione_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}-${now.getSeconds().toString().padStart(2, '0')}.txt`;
          
          setInputText(prev => prev + (prev ? "\n\n" : "") + `--- FILE: ${fileName} ---\n` + text);
          setUploadedFileNames(prev => [...prev, fileName]);
        } catch (error) {
          console.error("Errore trascrizione audio", error);
          alert("Errore durante la trascrizione dell'audio.");
        } finally {
          setLoading(false);
          stream.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Errore accesso microfono", error);
      alert("Impossibile accedere al microfono. Verifica i permessi.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
      setAudioLevel(0);
    }
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setLoadingMessage("Importazione file in corso...");
    setLoading(true);
    try {
      let accumulatedText = inputText;
      const newNames: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await processFile(file);
        accumulatedText += (accumulatedText ? "\n\n" : "") + `--- FILE: ${file.name} ---\n` + text;
        newNames.push(file.name);
      }
      setInputText(accumulatedText);
      setUploadedFileNames(prev => [...prev, ...newNames]);
    } catch (error) {
      alert("Errore lettura file.");
    } finally {
      setLoading(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  const removeFile = (index: number) => {
    const fileName = uploadedFileNames[index];
    if (fileName) {
      // Conta quante volte questo nome file appare prima dell'indice corrente
      const occurrenceIndex = uploadedFileNames.slice(0, index).filter(n => n === fileName).length;
      
      setInputText(prev => {
        const header = `--- FILE: ${fileName} ---`;
        const lines = prev.split('\n');
        const newLines: string[] = [];
        let skipping = false;
        let currentOccurrence = 0;

        for (let i = 0; i < lines.length; i++) {
          const isHeader = lines[i].trim() === header;
          
          if (isHeader) {
            if (currentOccurrence === occurrenceIndex) {
              skipping = true;
              currentOccurrence++;
              continue;
            }
            currentOccurrence++;
          }
          
          // Se stiamo saltando e troviamo un ALTRO header di file, smettiamo di saltare
          if (skipping && lines[i].startsWith('--- FILE: ') && lines[i].endsWith(' ---')) {
            skipping = false;
          }

          if (!skipping) {
            newLines.push(lines[i]);
          }
        }

        return newLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      });
    }
    setUploadedFileNames(prev => prev.filter((_, i) => i !== index));
  };

  const toggleStyleSuggestion = (style: string) => {
    setState(prev => {
      const currentStyles = prev.coverStyle ? prev.coverStyle.split(', ').filter(s => s) : [];
      const isSelected = currentStyles.includes(style);
      const newStyles = isSelected ? currentStyles.filter(s => s !== style) : [...currentStyles, style];
      return { ...prev, coverStyle: newStyles.join(', ') };
    });
  };

  const moveChapter = (id: string, direction: 'up' | 'down') => {
    setState(prev => {
      const index = prev.chapters.findIndex(c => c.id === id);
      if (index === -1) return prev;
      
      const newChapters = [...prev.chapters];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      
      if (targetIndex >= 0 && targetIndex < newChapters.length) {
        const [moved] = newChapters.splice(index, 1);
        newChapters.splice(targetIndex, 0, moved);
        return { ...prev, chapters: newChapters };
      }
      return prev;
    });
  };

  const toggleDeleteConfirmation = (id: string, show: boolean) => {
    setState(prev => ({
      ...prev,
      chapters: prev.chapters.map(ch => ch.id === id ? { ...ch, isConfirmingDelete: show } : ch)
    }));
  };

  const deleteChapter = (id: string) => {
    setState(prev => ({
      ...prev,
      chapters: prev.chapters.filter(ch => ch.id !== id)
    }));
  };

  const updateCustomColor = (key: keyof DocumentStyle, color: string) => {
    setState(prev => ({ ...prev, style: { ...prev.style, [key]: color } }));
  };

  const addNewPalette = (name: string) => {
    if (name && name.trim()) {
      const newPalette = { name: name.trim(), style: { ...state.style } };
      const newPalettes = [...(state.palettes || globalPalettes), newPalette];
      setState(prev => ({ ...prev, palettes: newPalettes }));
      setGlobalPalettes(newPalettes);
      setIsAddingPaletteUI(false);
      setNewPaletteName("");
      showToast("Palette aggiunta con successo!");
    }
  };

  const confirmDeletePalette = (name: string) => {
    const newPalettes = (state.palettes || globalPalettes).filter(pal => pal.name !== name);
    setState(prev => ({ ...prev, palettes: newPalettes }));
    setGlobalPalettes(newPalettes);
    setPaletteToDelete(null);
    showToast("Palette eliminata");
  };

  const addContact = () => {
    setState(s => ({
        ...s,
        contacts: [...s.contacts, { name: '', email: '', phone: '+39 ' }]
    }));
  };

  const updateContact = (index: number, field: keyof Contact, value: string) => {
    setState(prev => {
        const newContacts = [...prev.contacts];
        newContacts[index][field] = value;
        return { ...prev, contacts: newContacts };
    });
  };

  const removeContact = (index: number) => {
    setState(s => ({
        ...s,
        contacts: s.contacts.filter((_, i) => i !== index)
    }));
  };

  const handleGenerateMeta = async (chapterId: string, text: string) => {
    if (!text.trim() || generatingMetaForChapterId) return;
    
    setLoadingMessage("L'AI sta analizzando il testo e generando i metadati...");
    setLoading(true);
    setGeneratingMetaForChapterId(chapterId);
    try {
      const { subtitle, keywords } = await withTimeout(
        generateMetaFromContent(text),
        90000,
        "La generazione dei metadati sta impiegando troppo tempo. Riprova tra poco."
      );
      setState(prev => ({
        ...prev,
        chapters: prev.chapters.map(ch => 
          ch.id === chapterId ? { ...ch, subtitle, keywords } : ch
        )
      }));
    } catch (error) {
      console.error("Error generating meta:", error);
      showToast("Errore durante la generazione automatica. Riprova.", "error");
    } finally {
      setGeneratingMetaForChapterId(null);
      setLoading(false);
    }
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = state.title.replace(/\s+/g, '_');
    a.download = `${filenamePrefix}${safeTitle}_project.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          const mergedState = { ...DEFAULT_STATE, ...parsed };
          setState(mergedState);
          
          // Create an immediate restore point for the imported project
          // This ensures a "folder" is created in the history immediately
          const stateString = JSON.stringify(parsed);
          const snapshot = {
            timestamp: Date.now(),
            state: parsed,
            label: `Progetto Importato - ${new Date().toLocaleTimeString()}`,
            projectTitle: parsed.title || 'Senza Titolo'
          };
          
          await saveToDB("history", null, snapshot);
          await deleteOldestHistoryForProject(parsed.title || 'Senza Titolo');
          
          // Update the ref so auto-save doesn't trigger immediately for the same state
          lastSnapshotRef.current = stateString;
          
          showToast("Progetto caricato con successo!");
          handleNext();
          
          // Refresh history if modal happens to be open (unlikely but good practice)
          if (isHistoryModalOpen) {
            const items = await getAllFromDB("history");
            setHistoryItems(items.sort((a, b) => b.timestamp - a.timestamp));
          }
        } catch (error) {
          showToast("Errore nel caricamento del file progetto.", "error");
        }
      };
      reader.readAsText(file);
    }
  };

  const resetProject = async () => {
    if (window.confirm("Sei sicuro di voler resettare l'intero progetto? Tutte le modifiche non salvate andranno perse.")) {
      setState(DEFAULT_STATE);
      await removeFromDB("projects", STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    }
  };

  const htmlToPptxText = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    
    const objects: any[] = [];
    
    const parseNode = (node: Node, currentFormat: any) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const content = node.textContent;
            if (content) {
                // Only include formatting options that are true
                const options: any = {};
                if (currentFormat.bold) options.bold = true;
                if (currentFormat.italic) options.italic = true;
                if (currentFormat.underline) options.underline = true;
                
                objects.push({ text: content, options });
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const newFormat = { ...currentFormat };
            
            const tagName = el.tagName.toUpperCase();
            if (tagName === 'B' || tagName === 'STRONG') newFormat.bold = true;
            if (tagName === 'I' || tagName === 'EM') newFormat.italic = true;
            if (tagName === 'U') newFormat.underline = true;
            
            if (el.style) {
                if (el.style.fontWeight === 'bold' || el.style.fontWeight === '700' || el.style.fontWeight === 'bolder' || parseInt(el.style.fontWeight) >= 600) newFormat.bold = true;
                if (el.style.fontStyle === 'italic') newFormat.italic = true;
                if (el.style.textDecoration.includes('underline')) newFormat.underline = true;
            }
            
            if (tagName === 'BR') {
                objects.push({ text: '\n' });
            } else if (tagName === 'P' || tagName === 'DIV' || tagName === 'LI') {
                // Before block: if we have text and it doesn't end in newline, add one
                if (objects.length > 0 && objects[objects.length - 1].text !== '\n' && !objects[objects.length - 1].text.endsWith('\n')) {
                    objects.push({ text: '\n' });
                }
                
                el.childNodes.forEach(child => parseNode(child, newFormat));
                
                // After block: if we have text and it doesn't end in newline, add one
                if (objects.length > 0 && objects[objects.length - 1].text !== '\n' && !objects[objects.length - 1].text.endsWith('\n')) {
                    objects.push({ text: '\n' });
                }
            } else {
                el.childNodes.forEach(child => parseNode(child, newFormat));
            }
        }
    };

    div.childNodes.forEach(child => parseNode(child, {}));
    
    // Remove trailing newlines
    while (objects.length > 0 && objects[objects.length - 1].text === '\n') {
        objects.pop();
    }
    
    return objects;
  };

  const processImageForPPTX = async (dataUrl: string, zoom: number, position: {x: number, y: number}, objectFit: 'cover' | 'contain', targetW: number = 896, targetH: number = 720): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        
        let drawW = img.width;
        let drawH = img.height;
        let scale = 1;

        if (objectFit === 'cover') {
          scale = Math.max(targetW / img.width, targetH / img.height);
        } else {
          scale = Math.min(targetW / img.width, targetH / img.height);
        }

        drawW = img.width * scale;
        drawH = img.height * scale;

        const zoomFactor = zoom / 100;
        drawW *= zoomFactor;
        drawH *= zoomFactor;

        let dx = (targetW - drawW) / 2;
        let dy = (targetH - drawH) / 2;

        dx += targetW * ((position.x - 50) / 100);
        dy += targetH * ((position.y - 50) / 100);

        ctx.drawImage(img, dx, dy, drawW, drawH);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const exportToPPTX = async () => {
    setLoadingMessage("Generazione PPTX in corso...");
    setLoading(true);
    try {
      const pres = new pptxgen();
      pres.defineLayout({ name: 'TDA_LAYOUT', width: 13.33, height: 7.5 }); 
      pres.layout = 'TDA_LAYOUT';

      const bgCol = state.style.mainBg.replace('#','');
      const sideCol = state.style.sidebarBg.replace('#','');
      const sideTxt = state.style.sidebarText.replace('#','');
      const accent = state.style.accentColor.replace('#','');
      const mainTxt = state.style.mainText.replace('#','');

      const titlePt = (state.titleFontSize || 66.67) * 0.75;
      const subtitlePt = (state.subtitleFontSize || 16) * 0.75;
      const authorsPt = (state.authorsFontSize || 13.33) * 0.75;

      // 1. COVER SLIDE
      let coverSlide = pres.addSlide();
      coverSlide.background = { color: bgCol };
      
      // Sidebar (30%)
      coverSlide.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 4.0, h: 7.5, fill: { color: sideCol } });
      // Accent Line
      coverSlide.addShape(pres.ShapeType.rect, { x: 3.92, y: 0, w: 0.08, h: 7.5, fill: { color: accent } });

      // Authors: Montserrat Medium
      coverSlide.addText(state.authors.toUpperCase(), { 
        x: 0.416, y: 0.416, w: 3.168, 
        color: sideTxt, 
        fontSize: authorsPt, 
        fontFace: 'Montserrat',
        charSpacing: 2,
        lineSpacingMultiple: 1.4,
        margin: [0, 0, 0, 0]
      });
      
      // Title & Subtitle
      coverSlide.addText([
        { text: state.title.toUpperCase(), options: { color: accent, fontSize: titlePt, fontFace: 'Anton', breakLine: true, paraSpaceAfter: 24 } },
        { text: state.subtitle.toUpperCase(), options: { color: sideTxt, fontSize: subtitlePt, fontFace: 'Montserrat', charSpacing: 1.5 } }
      ], { 
        x: 0.416, y: 2.083, w: 3.168, 
        valign: 'top',
        lineSpacingMultiple: 1.1,
        margin: [0, 0, 0, 0]
      });
      
        if (state.coverImage) {
          // Cover image is full-bleed in the main area (70% of slide)
          const targetW = 896; // 1280 * 0.7
          const targetH = 720;
          const processedImage = await processImageForPPTX(
            state.coverImage, 
            state.coverZoom || 100, 
            state.coverPosition || {x: 50, y: 50}, 
            state.isCoverImageAiGenerated ? 'cover' : 'contain',
            targetW,
            targetH
          );
          coverSlide.addImage({ 
            data: processedImage, 
            x: 4.0, y: 0, w: 9.33, h: 7.5, 
            sizing: { type: 'cover', w: 9.33, h: 7.5 } 
          });
        }

      // 2. CHAPTER SLIDES
      const chaptersToExport = state.chapters.filter(ch => {
        const titleUpper = ch.title.toUpperCase();
        return !(ch.id === 'chapter-thanks' || titleUpper === 'GRAZIE' || titleUpper.includes('GRAZIE'));
      });

      for (let i = 0; i < chaptersToExport.length; i++) {
        const ch = chaptersToExport[i];
        const isContacts = ch.id === 'chapter-contacts' || ch.title.toUpperCase() === 'CONTATTI';
        
        let slide = pres.addSlide();
        slide.background = { color: bgCol };

        const isReverse = state.layoutType === 'print' && (i + 1) % 2 !== 0;
        
        const sidebarW = 4.0; 
        const mainW = 9.33;   
        
        const sidebarX = isReverse ? mainW : 0;
        const mainX = isReverse ? 0 : sidebarW;
        const accentX = isReverse ? mainW : sidebarW - 0.08;

        // Sidebar Background
        slide.addShape(pres.ShapeType.rect, { x: sidebarX, y: 0, w: sidebarW, h: 7.5, fill: { color: sideCol } });
        // Accent Line
        slide.addShape(pres.ShapeType.rect, { x: accentX, y: 0, w: 0.08, h: 7.5, fill: { color: accent } });

        // Sidebar Content
        slide.addText([
          { text: ch.title.replace(/:$/, '').trim().toUpperCase(), options: { color: accent, fontSize: (ch.titleFontSize || 53.33) * 0.75, fontFace: 'Anton', breakLine: true, paraSpaceAfter: 18 } },
          { text: ch.subtitle.toUpperCase(), options: { color: sideTxt, fontSize: (ch.subtitleFontSize || 16) * 0.75, fontFace: 'Montserrat', charSpacing: 1.5 } }
        ], { 
            x: sidebarX + 0.416, y: 2.083, w: 3.168, 
            valign: 'top',
            lineSpacingMultiple: 1.1,
            margin: [0, 0, 0, 0]
        });
        
        // Keywords
        if (ch.keywords && ch.keywords.length > 0) {
          const kwObjects = ch.keywords.flatMap((kw, idx) => [
            { text: '– ', options: { color: accent } },
            { text: kw, options: { color: sideTxt, breakLine: idx < ch.keywords.length - 1 } }
          ]);
          slide.addText(kwObjects, { 
              x: sidebarX + 0.2, y: 6.0, w: 3.6, h: 1.0,
              fontSize: 9.5, 
              italic: true, 
              fontFace: 'Montserrat',
              valign: 'bottom',
              lineSpacingMultiple: 1.2,
              margin: [0, 0, 0, 0]
          });
        }

        // Main Content Area
        if (isContacts) {
            // Footer text at the bottom
            slide.addText([
                { text: "COMPAGNIA TEATRO DELL'ARGINE", options: { color: sideCol, fontSize: 15, fontFace: 'Anton', breakLine: true, paraSpaceAfter: 12 } },
                { text: "c/o ITC Teatro di San Lazzaro - via Rimembranze, 26", options: { color: mainTxt, fontSize: 9, fontFace: 'Open Sans', breakLine: true } },
                { text: "40068 - San Lazzaro di Savena (BO)", options: { color: mainTxt, fontSize: 9, fontFace: 'Open Sans', breakLine: true } },
                { text: "tel +39 051 6271604 | www.teatrodellargine.org", options: { color: mainTxt, fontSize: 9, fontFace: 'Open Sans' } }
            ], { 
                x: mainX + 0.5, y: 6.0, w: 8.33, h: 1.0, 
                align: 'right', 
                valign: 'bottom',
                lineSpacingMultiple: 1.6,
                margin: [0, 0, 0, 0]
            });

            // Contacts stacked above the footer
            const validContacts = state.contacts.filter(c => c.name.trim() !== '' || c.email.trim() !== '' || (c.phone.trim() !== '' && c.phone.trim() !== '+39'));
            
            const allContactsText: any[] = [];
            validContacts.forEach((c, idx) => {
                const nameFontSize = (24 + (state.contactsFontSizeOffset || 0)) * 0.75;
                const roleFontSize = (16 + (state.contactsFontSizeOffset || 0)) * 0.75;
                const emailFontSize = (16 + (state.contactsFontSizeOffset || 0)) * 0.75;
                const phoneFontSize = (14 + (state.contactsFontSizeOffset || 0)) * 0.75;

                allContactsText.push({ text: c.name.toUpperCase(), options: { color: sideCol, fontSize: nameFontSize, fontFace: 'Anton', breakLine: true } });
                if (c.role) {
                    allContactsText.push({ text: c.role, options: { color: mainTxt, fontSize: roleFontSize, fontFace: 'Montserrat', breakLine: true } });
                }
                if (c.email) {
                    allContactsText.push({ text: c.email, options: { color: mainTxt, fontSize: emailFontSize, fontFace: 'Montserrat', breakLine: true } });
                }
                allContactsText.push({ text: c.phone || '+39 ', options: { color: mainTxt, fontSize: phoneFontSize, fontFace: 'Montserrat', breakLine: idx < validContacts.length - 1, paraSpaceAfter: idx < validContacts.length - 1 ? 18 : 0 } });
            });

            if (allContactsText.length > 0) {
                slide.addText(allContactsText, { 
                    x: mainX + 0.5, y: 0.5, w: 8.33, h: 5.2, // up to footer
                    align: 'right', 
                    valign: 'bottom',
                    lineSpacingMultiple: 1.2,
                    margin: [0, 0, 0, 0]
                });
            }
        } else {
            // Chapter Image
            if (ch.image) {
                // Chapter images in UI have 48px padding (approx 0.5 inches at 96dpi)
                // Slide is 13.33x7.5 inches. Main area is 9.33x7.5 inches.
                // Padded area is 8.33x6.5 inches.
                const targetW = 800; // ~8.33 inches * 96
                const targetH = 624; // 6.5 inches * 96
                
                const processedImage = await processImageForPPTX(
                  ch.image, 
                  ch.imageZoom || 100, 
                  ch.imagePosition || {x: 50, y: 50}, 
                  'contain',
                  targetW,
                  targetH
                );
                slide.addImage({ 
                  data: processedImage, 
                  x: mainX + 0.5, y: 0.5, w: 8.33, h: 6.5, 
                  sizing: { type: 'contain', w: 8.33, h: 6.5 } 
                });
            }

            // Chapter Content Text
            if (ch.content) {
              const pptxTextObjects = htmlToPptxText(ch.content);

              slide.addText(pptxTextObjects, { 
                  x: mainX + 0.5, y: 0.5, w: 8.33, h: 6.5, 
                  align: 'justify', 
                  valign: 'middle',
                  fontFace: 'Open Sans', 
                  color: mainTxt, 
                  fontSize: 12,
                  lineSpacingMultiple: 1.4,
                  margin: [0, 0, 0, 0]
              });
            }
        }
      }

      await pres.writeFile({ fileName: `${state.title.replace(/\s+/g, '_')}.pptx` });
    } catch (err) {
      console.error(err);
      alert("Errore durante l'esportazione PPTX");
    } finally {
      setLoading(false);
    }
  };

    const handleSaveAsPDF = async () => {
    const element = document.getElementById('pdf-content');
    if (!element) return;

    setLoadingMessage("Inizializzazione esportazione PDF...");
    setLoading(true);
    setIsPdfModalOpen(false);

    try {
        await (document as any).fonts.ready;
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: [338.67, 190.5]
        });
        const wrappers = element.querySelectorAll('.page-wrapper');
        const totalPages = wrappers.length;
        
        // Parse page range
        let pagesToExport = new Set<number>();
        if (pdfPageRange.trim().toLowerCase() === 'all' || pdfPageRange.trim() === '') {
            for (let i = 0; i < totalPages; i++) pagesToExport.add(i);
        } else {
            const parts = pdfPageRange.split(',');
            for (const part of parts) {
                const range = part.trim().split('-');
                if (range.length === 1) {
                    const pageNum = parseInt(range[0]);
                    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                        pagesToExport.add(pageNum - 1);
                    }
                } else if (range.length === 2) {
                    const start = parseInt(range[0]);
                    const end = parseInt(range[1]);
                    if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= totalPages && start <= end) {
                        for (let i = start; i <= end; i++) {
                            pagesToExport.add(i - 1);
                        }
                    }
                }
            }
        }
        
        if (pagesToExport.size === 0) {
            alert("Nessuna pagina valida selezionata per l'esportazione.");
            setLoading(false);
            return;
        }

        let processedCount = 0;
        for (let i = 0; i < totalPages; i++) {
            if (!pagesToExport.has(i)) continue;
            
            setLoadingMessage(`Esportazione pagina ${i + 1} di ${totalPages}...`);
            const pageWrapper = wrappers[i] as HTMLElement;
            const pageElement = pageWrapper.querySelector('.page') as HTMLElement;
            
            // Use htmlToImage without cacheBust, and add a timeout to prevent hanging
            const timeoutPromise = new Promise<string>((_, reject) => {
                setTimeout(() => reject(new Error("Timeout esportazione pagina")), 30000);
            });
            
            const dataUrl = await Promise.race([
                htmlToImage.toPng(pageElement, {
                    pixelRatio: pdfQuality === 'high' ? 3 : 2,
                    backgroundColor: state.style.mainBg,
                }),
                timeoutPromise
            ]);
            
            if (processedCount > 0) {
                pdf.addPage([338.67, 190.5], 'landscape');
            }
            pdf.addImage(dataUrl, 'PNG', 0, 0, 338.67, 190.5, undefined, 'FAST');
            processedCount++;
            await new Promise(r => setTimeout(r, 100));
        }
        
        setLoadingMessage("Salvataggio file PDF...");
        const safeTitle = state.title.replace(/\s+/g, '_');
        pdf.save(`${filenamePrefix}${safeTitle}.pdf`);
    } catch (err) {
        console.error(err);
        alert("Si è verificato un errore durante l'esportazione del PDF.");
    } finally {
        setLoading(false);
    }
  };

  const updateChapterImageConfig = (id: string, updates: Partial<Chapter>) => {
    setState(prev => {
      const newChapters = prev.chapters.map(ch => 
        ch.id === id ? { ...ch, ...updates } : ch
      );
      return { ...prev, chapters: newChapters };
    });
  };

  // UI Scale Factors
  const scaleFactor = windowWidth < 400 ? 0.18 : (windowWidth < 768 ? 0.22 : (windowWidth < 1024 ? 0.28 : 0.32));
  const previewWidth = 338.67 * scaleFactor;
  const previewHeight = 190.5 * scaleFactor;
  const wideScaleFactor = windowWidth < 400 ? 0.35 : (windowWidth < 768 ? 0.45 : (windowWidth < 1024 ? 0.55 : 0.7));
  const widePreviewWidth = 338.67 * wideScaleFactor;
  const widePreviewHeight = 190.5 * wideScaleFactor;

  // Final Preview Scale (Step.Preview)
  // 338.67mm is approx 1280px. We want it to fit in windowWidth with some padding.
  const finalScaleFactor = (windowWidth < 1320 ? Math.min(1, (windowWidth - 48) / 1280) : 1) * userPreviewZoom;
  const finalPreviewHeightMm = 190.5 * finalScaleFactor;

  if (currentStep === Step.PrintPreview) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col items-center transition-colors duration-500">
        {loading && (
          <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-xl z-[9999] flex flex-col items-center justify-center text-white">
              <div className="relative w-20 h-20 mb-6">
                  <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <h2 className="text-xl font-black uppercase tracking-widest text-white">{loadingMessage}</h2>
          </div>
        )}
        <div className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b z-50 p-2 md:p-4 flex justify-between items-center no-print shadow-sm">
          <button onClick={() => setCurrentStep(Step.Preview)} className="px-4 md:px-6 py-2 bg-slate-900 text-white rounded-lg font-black uppercase text-[10px] tracking-widest shadow-md hover:bg-indigo-600 transition-all flex items-center gap-2"><span>←</span> Indietro</button>
          <div className="hidden md:block text-[10px] font-black uppercase text-slate-400 tracking-[0.4em]">Anteprima Finale Esportazione</div>
          <button onClick={() => setIsPdfModalOpen(true)} className="px-4 md:px-8 py-2 bg-indigo-600 text-white rounded-lg font-black uppercase text-[10px] tracking-widest shadow-lg hover:bg-indigo-700 transition-all">Configura & Scarica PDF</button>
        </div>
        <div id="final-print-content" className="flex flex-col items-center pt-24 pb-20 preview-gap w-full overflow-hidden">
          <div id="pdf-content" className="flex flex-col items-center gap-0">
              <div 
                className="flex justify-center w-full overflow-hidden" 
                style={{ height: `${finalPreviewHeightMm}mm`, marginBottom: windowWidth < 768 ? '20px' : '40px' }}
              >
                <div 
                  className="origin-top shrink-0" 
                  style={{ transform: `scale(${finalScaleFactor})`, width: '338.67mm', height: '190.5mm' }}
                >
                  <div className="page-wrapper shrink-0">
                    <PagePreview style={state.style} isCover title={state.title} titleFontSize={state.titleFontSize || DEFAULT_TITLE_FONT_SIZE} subtitle={state.subtitle} subtitleFontSize={state.subtitleFontSize || DEFAULT_SUBTITLE_FONT_SIZE} authors={state.authors} authorsFontSize={state.authorsFontSize || DEFAULT_AUTHORS_FONT_SIZE} coverImage={state.coverImage} isCoverImageAiGenerated={state.isCoverImageAiGenerated} coverZoom={state.coverZoom} coverPosition={state.coverPosition} layoutType={state.layoutType} contacts={state.contacts} contactsFontSizeOffset={state.contactsFontSizeOffset} pageIndex={0} />
                  </div>
                </div>
              </div>

              {state.chapters.map((ch, i) => (
                <div 
                  key={ch.id} 
                  className="flex justify-center w-full overflow-hidden" 
                  style={{ height: `${finalPreviewHeightMm}mm`, marginBottom: windowWidth < 768 ? '20px' : '40px' }}
                >
                  <div 
                    className="origin-top shrink-0" 
                    style={{ transform: `scale(${finalScaleFactor})`, width: '338.67mm', height: '190.5mm' }}
                  >
                    <div className="page-wrapper shrink-0">
                      <PagePreview style={state.style} title={state.title} chapter={ch} pageIndex={i+1} layoutType={state.layoutType} contacts={state.contacts} contactsFontSizeOffset={state.contactsFontSizeOffset} />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-200/50 dark:bg-slate-950 pb-16 transition-colors duration-500">
      {loading && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl z-[9999] flex flex-col items-center justify-center text-white animate-in fade-in duration-500">
            <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tighter text-white">{loadingMessage}</h2>
        </div>
      )}

      {/* Hidden file inputs */}
      <input type="file" ref={chapterImageInputRef} className="hidden" accept="image/*" onChange={handleChapterImageUpload} />
      <input type="file" ref={projectInputRef} className="hidden" accept=".json" onChange={importProject} />

      {isHistoryModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[10000] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-2xl w-full max-h-[80vh] flex flex-col space-y-6 animate-in zoom-in-95 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center border-b border-slate-100 pb-6">
              <div className="space-y-1">
                <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Cronologia Punti di Ripristino</h3>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ripristina una versione precedente del tuo lavoro</p>
                  {selectedHistoryProject && (
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[9px] font-black uppercase tracking-widest">
                      {historyItems.filter(item => (item.projectTitle || item.state?.title || 'Senza Titolo') === selectedHistoryProject).length} / {MAX_HISTORY_ITEMS} Slot
                    </span>
                  )}
                </div>
              </div>
              <button onMouseDown={(e) => { e.preventDefault(); setIsHistoryModalOpen(false); }} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all text-2xl font-bold">×</button>
            </div>
            
            {selectedHistoryProject !== null && (
              <div className="flex items-center justify-between">
                <button onClick={() => { setSelectedHistoryProject(null); setIsConfirmingDeleteProject(false); }} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-800 transition-colors">
                  <ChevronLeft className="w-4 h-4" /> Torna alle cartelle
                </button>
                
                {isConfirmingDeleteProject ? (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-red-600">Sei sicuro?</span>
                    <button 
                      onClick={() => deleteProjectHistory(selectedHistoryProject)}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg font-black uppercase text-[9px] tracking-widest hover:bg-red-700 transition-all shadow-md"
                    >
                      Sì, Elimina Tutto
                    </button>
                    <button 
                      onClick={() => setIsConfirmingDeleteProject(false)}
                      className="px-3 py-1.5 bg-slate-200 text-slate-600 rounded-lg font-black uppercase text-[9px] tracking-widest hover:bg-slate-300 transition-all"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setIsConfirmingDeleteProject(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-red-100 transition-all border border-red-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Elimina Cartella
                  </button>
                )}
              </div>
            )}
            
            <div 
              ref={historyScrollRef}
              onScroll={checkHistoryScroll}
              className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar relative"
            >
              {historyItems.length === 0 ? (
                <div className="py-20 text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Nessun punto di ripristino trovato</p>
                </div>
              ) : selectedHistoryProject === null ? (
                Object.entries(
                  historyItems.reduce((acc, item) => {
                    const title = item.projectTitle || item.state?.title || 'Senza Titolo';
                    if (!acc[title]) acc[title] = [];
                    acc[title].push(item);
                    return acc;
                  }, {} as Record<string, any[]>)
                ).map(([title, items]: [string, any]) => (
                  <div key={title} onClick={() => setSelectedHistoryProject(title)} className="group p-5 bg-slate-50 hover:bg-white border-2 border-transparent hover:border-indigo-100 rounded-2xl transition-all flex items-center justify-between shadow-sm hover:shadow-md cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[14px] font-black uppercase tracking-widest text-slate-800">{title}</div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {items.length} / {MAX_HISTORY_ITEMS} Salvataggi
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  </div>
                ))
              ) : (
                <>
                  {historyItems.filter(item => (item.projectTitle || item.state?.title || 'Senza Titolo') === selectedHistoryProject).map((item, index, array) => (
                    <div key={item.timestamp} className="group p-5 bg-slate-50 hover:bg-white border-2 border-transparent hover:border-indigo-100 rounded-2xl transition-all flex items-center justify-between shadow-sm hover:shadow-md">
                      <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center font-black text-xs">
                          {index + 1}
                        </div>
                        <div className="space-y-1">
                          <div className="text-[11px] font-black uppercase tracking-widest text-indigo-600">{item.label}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {new Date(item.timestamp).toLocaleDateString()} - {new Date(item.timestamp).toLocaleTimeString()}
                          </div>
                          <div className="text-[9px] font-medium text-slate-500 italic">
                            {item.state.chapters.length} capitoli • {item.state.title}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {confirmingLoadTimestamp === item.timestamp ? (
                          <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-2">
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); loadHistoryItem(item); }}
                              className="px-3 py-2 bg-green-600 text-white rounded-lg font-black uppercase text-[9px] tracking-widest hover:bg-green-700 transition-all shadow-md"
                            >
                              Sì, Carica
                            </button>
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); setConfirmingLoadTimestamp(null); }}
                              className="px-3 py-2 bg-slate-200 text-slate-700 rounded-lg font-black uppercase text-[9px] tracking-widest hover:bg-slate-300 transition-all"
                            >
                              No
                            </button>
                          </div>
                        ) : confirmingDeleteTimestamp === item.timestamp ? (
                          <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-2">
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); deleteHistoryItem(item.timestamp); setConfirmingDeleteTimestamp(null); }}
                              className="px-3 py-2 bg-red-600 text-white rounded-lg font-black uppercase text-[9px] tracking-widest hover:bg-red-700 transition-all shadow-md"
                            >
                              Sì, Elimina
                            </button>
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); setConfirmingDeleteTimestamp(null); }}
                              className="px-3 py-2 bg-slate-200 text-slate-700 rounded-lg font-black uppercase text-[9px] tracking-widest hover:bg-slate-300 transition-all"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <>
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); setConfirmingLoadTimestamp(item.timestamp); }}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-black uppercase text-[9px] tracking-widest hover:bg-indigo-700 transition-all shadow-md"
                              title="Ripristina questa versione"
                            >
                              Carica
                            </button>
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); downloadHistoryItem(item); }}
                              className="px-4 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg font-black uppercase text-[9px] tracking-widest hover:bg-slate-50 transition-all shadow-sm"
                              title="Scarica come JSON"
                            >
                              Scarica
                            </button>
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); setConfirmingDeleteTimestamp(item.timestamp); }}
                              className="w-9 h-9 flex items-center justify-center bg-white text-red-400 border border-red-50 rounded-lg hover:bg-red-50 hover:text-red-600 transition-all"
                              title="Elimina"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {showHistoryScrollArrow && (
              <div 
                onClick={() => {
                  if (historyScrollRef.current) {
                    historyScrollRef.current.scrollBy({ top: 100, behavior: 'smooth' });
                  }
                }}
                className="absolute bottom-12 left-1/2 -translate-x-1/2 cursor-pointer z-[10001] animate-bounce"
              >
                <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center shadow-xl border-2 border-white">
                  <ArrowDown className="w-6 h-6 text-white" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isFavoritesOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[10000] flex items-center justify-center p-2 md:p-4">
          <div className="bg-white rounded-3xl md:rounded-[2.5rem] p-5 md:p-8 max-w-5xl w-full max-h-[95vh] md:max-h-[90vh] flex flex-col space-y-2 md:space-y-4 animate-in zoom-in-95 shadow-2xl border border-slate-100 relative">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2 md:pb-4">
              <div className="space-y-0.5">
                <h3 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">Immagini Preferite</h3>
              </div>
              <button onMouseDown={(e) => { e.preventDefault(); setIsFavoritesOpen(false); }} className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all text-xl md:text-2xl font-bold">×</button>
            </div>

            <div className="relative flex-1 overflow-hidden flex flex-col">
              <div 
                ref={favoritesScrollRef}
                onScroll={handleFavoritesScroll}
                className="flex-1 overflow-y-scroll pr-2 custom-scrollbar"
              >
                {favoritesItems.length === 0 ? (
                  <div className="py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                      <svg className="w-8 h-8 text-slate-300" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                    </div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Nessuna immagine salvata nei preferiti</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 pb-6 px-4 md:px-8">
                    {favoritesItems.map((item) => (
                      <div key={item.id} className="group relative bg-slate-50 rounded-2xl overflow-hidden border-2 border-transparent hover:border-indigo-500 transition-all shadow-sm hover:shadow-xl">
                        <div className="aspect-[4/3] overflow-hidden cursor-zoom-in" onMouseDown={(e) => { e.preventDefault(); setPreviewImage(item.image); }}>
                          <img src={item.image} alt={item.subject} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" />
                        </div>
                        
                        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4 text-center pointer-events-none z-10">
                          <p className="text-[13px] font-black text-white uppercase tracking-widest mb-1 line-clamp-2">{item.subject}</p>
                          <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest mb-4">{item.style}</p>
                          <div className="flex gap-2 pointer-events-auto">
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); useFavoriteAsCover(item.image); }}
                              className="px-4 py-2 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-indigo-500 transition-all shadow-lg"
                            >
                              Carica
                            </button>
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); setPreviewImage(item.image); }}
                              className="w-10 h-10 bg-white/10 text-white flex items-center justify-center rounded-lg hover:bg-white/20 transition-all shadow-lg backdrop-blur-sm border border-white/10"
                              title="Anteprima a schermo intero"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 7v6m3-3H7" />
                              </svg>
                            </button>
                            <button 
                              onMouseDown={(e) => { 
                                e.preventDefault(); 
                                const link = document.createElement('a');
                                link.href = item.image;
                                const safeSubject = (item.subject || '').replace(/[^a-z0-9]/gi, '_').substring(0, 50);
                                const safeStyle = (item.style || '').replace(/[^a-z0-9]/gi, '_').substring(0, 50);
                                link.download = `Copertina_${safeSubject}_${safeStyle}.png`;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                                showToast("Download avviato", "success");
                              }}
                              className="w-10 h-10 bg-white/10 text-white flex items-center justify-center rounded-lg hover:bg-white/20 transition-all shadow-lg backdrop-blur-sm border border-white/10"
                              title="Scarica immagine"
                            >
                              <Download size={16} />
                            </button>
                            {confirmDeleteFavoriteId === item.id ? (
                              <div className="flex bg-red-600 text-white rounded-lg overflow-hidden shadow-lg animate-in fade-in zoom-in duration-200">
                                <button 
                                  onMouseDown={(e) => { e.preventDefault(); removeFromFavorites(item.id); setConfirmDeleteFavoriteId(null); }}
                                  className="px-3 py-2 text-[10px] font-black uppercase hover:bg-red-700 transition-colors border-r border-red-500"
                                >
                                  Sì
                                </button>
                                <button 
                                  onMouseDown={(e) => { e.preventDefault(); setConfirmDeleteFavoriteId(null); }}
                                  className="px-3 py-2 text-[10px] font-black uppercase hover:bg-red-700 transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button 
                                onMouseDown={(e) => { e.preventDefault(); setConfirmDeleteFavoriteId(item.id); }}
                                className="p-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-all shadow-lg"
                                title="Rimuovi"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Gradient Fade */}
              {!isAtBottom && (
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none z-50" />
              )}
            </div>

            {/* Scroll Indicator Hint */}
            {!isAtBottom && favoritesItems.length > 0 && (
              <button 
                onMouseDown={(e) => { 
                  e.preventDefault(); 
                  favoritesScrollRef.current?.scrollBy({ top: 300, behavior: 'smooth' });
                }}
                className="absolute bottom-1 md:bottom-2 left-1/2 -translate-x-1/2 bg-indigo-600/90 hover:bg-indigo-600 text-white w-8 h-8 rounded-full shadow-2xl animate-bounce z-[100] flex items-center justify-center border border-white/20 backdrop-blur-sm cursor-pointer transition-colors"
                title="Scorri giù"
              >
                <ArrowDown size={16} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      )}

      {previewImage && (
        <div 
          className="fixed inset-0 bg-black/95 z-[20000] flex items-center justify-center p-4 cursor-zoom-out"
          onMouseDown={(e) => { e.preventDefault(); setPreviewImage(null); }}
        >
          <div 
            className="relative max-w-5xl w-full h-full flex items-center justify-center"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <img 
              src={previewImage} 
              alt="Preview" 
              className="max-w-full max-h-full object-contain shadow-2xl rounded-lg checkerboard" 
              referrerPolicy="no-referrer" 
            />
            <button 
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewImage(null); }}
              className="absolute top-4 right-4 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-all text-3xl font-bold backdrop-blur-md"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <header className="bg-slate-900 text-white border-b border-slate-800 py-0.5 md:py-1 sticky top-0 z-50 no-print">
        <div className="max-w-[1600px] mx-auto px-2 md:px-6 flex justify-between items-center gap-2">
          <div className="hidden sm:block font-black text-[8.5px] md:text-[12px] uppercase tracking-widest truncate shrink-0">TDA Dossier</div>
          <StepIndicator currentStep={currentStep} onStepClick={goToStep} />
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-2 md:px-6 mt-4">
        {currentStep === Step.Selection && (
          <div className="max-w-5xl mx-auto pt-2 pb-8 md:pt-4 md:pb-12 animate-in fade-in zoom-in-95 h-full flex flex-col justify-start">
            <div className="text-center mb-6 md:mb-8">
              <div className="flex items-center justify-center gap-4 mb-2">
                <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold tracking-tighter text-slate-900 uppercase leading-tight montserrat-bold">CREA DOSSIER TdA</h1>
              </div>
              <div className="mt-2 inline-block px-4 sm:px-8 py-2 bg-indigo-600 text-white rounded-full text-[9px] sm:text-[11px] font-bold uppercase tracking-widest shadow-xl border-2 border-indigo-500 transform hover:scale-105 transition-transform max-w-[90%] truncate">
                PROGETTO ATTIVO: <span className="ml-2 underline underline-offset-4 decoration-white/50">{state.title || "NESSUN TITOLO"}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8 px-2 md:px-0">
              {/* Option 1: Load File */}
              <button 
                onMouseDown={(e) => { e.preventDefault(); projectInputRef.current?.click(); }} 
                className="group p-4 bg-white border-2 border-slate-200 hover:border-[#4C4CDD] hover:bg-[#4C4CDD] rounded-[2rem] shadow-sm hover:shadow-xl transition-all text-center flex flex-col items-center"
              >
                <div className="w-10 h-10 bg-slate-50 rounded-xl mb-3 flex items-center justify-center group-hover:bg-white transition-colors">
                  <svg className="w-5 h-5 text-slate-400 group-hover:text-[#4C4CDD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold uppercase tracking-tight montserrat-bold text-black group-hover:text-white">Carica File</h3>
                <p className="text-[8px] text-black mt-1 font-bold uppercase tracking-widest group-hover:text-white/80">Importa .json</p>
              </button>

              {/* Option 4: New Project */}
              <button 
                onMouseDown={(e) => { e.preventDefault(); setState({...DEFAULT_STATE, layoutType: state.layoutType, authors: defaultAuthor, palettes: globalPalettes}); handleNext(); }} 
                className="group p-4 bg-white border-2 border-slate-200 hover:border-[#4C4CDD] hover:bg-[#4C4CDD] rounded-[2rem] shadow-sm hover:shadow-xl transition-all text-center flex flex-col items-center"
              >
                <div className="w-10 h-10 bg-slate-50 rounded-xl mb-3 flex items-center justify-center group-hover:bg-white transition-colors">
                  <svg className="w-5 h-5 text-slate-400 group-hover:text-[#4C4CDD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold uppercase tracking-tight montserrat-bold text-black group-hover:text-white">Nuovo Progetto</h3>
                <p className="text-[8px] text-black mt-1 font-bold uppercase tracking-widest group-hover:text-white/80">Inizia da zero</p>
              </button>
            </div>

            <div className="max-w-xl mx-auto space-y-4 bg-white p-6 rounded-[2rem] shadow-lg border border-slate-100">
              <p className="text-center text-[9px] font-bold uppercase tracking-[0.3em] text-black">Template Documento</p>
              <div className="flex flex-col md:flex-row gap-3">
                <button 
                  onMouseDown={(e) => { e.preventDefault(); setState({...state, layoutType: 'computer'}); }}
                  className={`flex-1 py-3 px-6 rounded-2xl text-[11px] font-bold uppercase tracking-widest transition-all border-2 flex flex-col items-center gap-1 ${state.layoutType === 'computer' ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg' : 'bg-slate-50 text-slate-400 border-transparent hover:bg-slate-100 hover:text-slate-600'}`}
                >
                  <span className="montserrat-bold">Layout Slide e PC</span>
                  <span className={`text-[8px] normal-case font-medium ${state.layoutType === 'computer' ? 'text-white/80' : 'text-indigo-600'}`}>Ottimizzato schermi</span>
                </button>
                <button 
                  onMouseDown={(e) => { e.preventDefault(); setState({...state, layoutType: 'print'}); }}
                  className={`flex-1 py-3 px-6 rounded-2xl text-[11px] font-bold uppercase tracking-widest transition-all border-2 flex flex-col items-center gap-1 ${state.layoutType === 'print' ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg' : 'bg-slate-50 text-slate-400 border-transparent hover:bg-slate-100 hover:text-slate-600'}`}
                >
                  <span className={`montserrat-bold ${state.layoutType === 'print' ? 'text-white' : 'text-black'}`}>Layout Stampa</span>
                  <span className={`text-[8px] normal-case font-medium ${state.layoutType === 'print' ? 'text-white/80' : 'text-black'}`}>Fronte/retro alternate</span>
                </button>
              </div>
            </div>

          </div>
        )}

        {currentStep === Step.Setup && (
          <div className={`grid grid-cols-1 gap-4 items-start transition-all ${isWidePreview ? 'xl:grid-cols-[450px_1fr]' : 'xl:grid-cols-[1fr_450px]'}`}>
            <div className="bg-white p-3 sm:p-5 md:p-6 rounded-2xl md:rounded-3xl shadow-lg flex flex-col">
              <div className={`flex flex-col ${isWidePreview ? 'lg:flex-col' : 'lg:grid lg:grid-cols-[30%_1fr]'} gap-4 md:gap-6 items-stretch flex-grow`}>
                {/* COLUMN 1: TESTI + CARICA (COMPACT) */}
                <div className="flex flex-col space-y-2 md:space-y-3">
                  <section className="space-y-2">
                    <div className="flex items-center justify-between border-b-2 pb-1 mb-2">
                      <h2 className="text-base font-black uppercase tracking-tighter text-black">1. TESTI COPERTINA</h2>
                    </div>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[9px] font-black uppercase text-indigo-600 tracking-widest pl-1">Autori</label>
                          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5 mr-1">
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, authorsFontSize: Math.max(5, (s.authorsFontSize ?? DEFAULT_AUTHORS_FONT_SIZE) - 0.5)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Rimpicciolisce Autori">-</button>
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, authorsFontSize: Math.min(50, (s.authorsFontSize ?? DEFAULT_AUTHORS_FONT_SIZE) + 0.5)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Ingrandisce Autori">+</button>
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, authorsFontSize: DEFAULT_AUTHORS_FONT_SIZE})); }} className="ml-1 w-5 h-5 flex items-center justify-center hover:bg-indigo-600 hover:text-white rounded transition-colors text-[8px] font-black text-indigo-600 border border-indigo-200" title="Ripristina Autori">R</button>
                          </div>
                        </div>
                        <textarea placeholder="Autori" className="w-full p-2.5 rounded-xl bg-slate-50 border text-xs h-[46px] resize-none outline-none focus:ring-2 ring-indigo-500/10 transition-all text-slate-900" value={state.authors} onChange={e => setState({...state, authors: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[9px] font-black uppercase text-indigo-600 tracking-widest pl-1">Titolo</label>
                          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5 mr-1">
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, titleFontSize: Math.max(10, (s.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE) - 1)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Rimpicciolisce Titolo">-</button>
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, titleFontSize: Math.min(250, (s.titleFontSize ?? DEFAULT_TITLE_FONT_SIZE) + 1)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Ingrandisce Titolo">+</button>
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, titleFontSize: DEFAULT_TITLE_FONT_SIZE})); }} className="ml-1 w-5 h-5 flex items-center justify-center hover:bg-indigo-600 hover:text-white rounded transition-colors text-[8px] font-black text-indigo-600 border border-indigo-200" title="Ripristina Titolo">R</button>
                          </div>
                        </div>
                        <textarea placeholder="TITOLO PROGETTO" className="w-full p-2.5 rounded-xl bg-slate-50 border font-black text-xs h-[46px] resize-none outline-none focus:ring-2 ring-indigo-500/10 text-slate-900" value={state.title} onChange={e => setState({...state, title: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[9px] font-black uppercase text-indigo-600 tracking-widest pl-1">SOTTOTITOLO</label>
                          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5 mr-1">
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, subtitleFontSize: Math.max(8, (s.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE) - 0.5)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Rimpicciolisce Sottotitolo">-</button>
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, subtitleFontSize: Math.min(60, (s.subtitleFontSize ?? DEFAULT_SUBTITLE_FONT_SIZE) + 0.5)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Ingrandisce Sottotitolo">+</button>
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, subtitleFontSize: DEFAULT_SUBTITLE_FONT_SIZE})); }} className="ml-1 w-5 h-5 flex items-center justify-center hover:bg-indigo-600 hover:text-white rounded transition-colors text-[8px] font-black text-indigo-600 border border-indigo-200" title="Ripristina Sottotitolo">R</button>
                          </div>
                        </div>
                        <textarea placeholder="SOTTOTITOLO" className="w-full p-2.5 rounded-xl bg-slate-50 border text-[12px] h-[46px] resize-none outline-none focus:ring-2 ring-indigo-500/10 text-slate-900" value={state.subtitle} onChange={e => setState({...state, subtitle: e.target.value})} />
                      </div>
                    </div>
                  </section>

                  <section className="space-y-2 pt-1 mt-auto">
                    <h2 className="text-base font-black uppercase tracking-tighter text-black border-b-2 pb-1">2. CARICA</h2>
                    <div className="flex gap-2">
                      <button 
                        onMouseDown={(e) => { e.preventDefault(); fileInputRef.current?.click(); }} 
                        className="flex-1 h-12 flex flex-row items-center justify-center gap-3 bg-white border-2 border-slate-200 hover:border-[#4C4CDD] hover:bg-[#4C4CDD] hover:text-white text-black rounded-2xl transition-all group shadow-sm hover:shadow-xl px-4"
                      >
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                        <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center group-hover:bg-white transition-colors shrink-0">
                          <svg className="w-4 h-4 text-slate-400 group-hover:text-[#4C4CDD]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M7 16l5-5 5 5M12 11v9" /></svg>
                        </div>
                        <span className="text-[11px] font-black uppercase tracking-widest leading-tight text-center">Carica immagine</span>
                      </button>
                    </div>
                  </section>
                </div>

                {/* COLUMN 2: GENERATORE IA (WIDE) */}
                <div className={`flex flex-col space-y-2 border-t lg:border-t-0 ${isWidePreview ? 'lg:border-t lg:pt-4 lg:pl-0' : 'lg:border-l lg:pt-0 lg:pl-6'}`}>
                  <section className="space-y-1.5">
                    <div className="flex justify-between items-center border-b-2 pb-1">
                      <h2 className="text-base font-black uppercase tracking-tighter text-black">3. GENERATORE IA</h2>
                    </div>
                    <div className="space-y-1.5">
                      <div className="space-y-0.5">
                        <label className="text-[11px] font-black uppercase text-indigo-600 tracking-widest pl-1">Descrivi l'immagine che ti serve</label>
                        <textarea placeholder="Esempio: Una scena teatrale onirica con luci soffuse..." className="w-full h-12 p-4 bg-slate-50 border text-[14px] rounded-xl shadow-inner focus:ring-2 ring-indigo-500/10 outline-none transition-all resize-none text-slate-900" value={state.coverSubject} onChange={e => setState({...state, coverSubject: e.target.value})} />
                      </div>
                      
                      <div className="space-y-1">
                        {(Object.entries(STYLE_CATEGORIES) as [string, {name: string, desc: string}[]][]).map(([cat, styles]) => (
                          <div key={cat} className="space-y-0.5">
                            <h4 className="text-[10px] font-black uppercase text-indigo-600 tracking-[0.2em] pl-1">{cat.toUpperCase()}</h4>
                            <div className="flex flex-wrap gap-1.5 p-1.5 bg-slate-50/50 rounded-xl border border-slate-100">
                              {styles.map(s => (
                                <div key={s.name} className="style-tooltip-container">
                                  <button onMouseDown={(e) => { e.preventDefault(); toggleStyleSuggestion(s.name); }} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase border transition-all hover:scale-105 active:scale-95 ${state.coverStyle.split(', ').includes(s.name) ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'}`}>{s.name}</button>
                                  <span className="style-tooltip">{s.desc}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="pt-0.5 mt-auto space-y-2">
                    <button onMouseDown={(e) => { e.preventDefault(); handleAIGenImage(); }} className="w-full h-12 flex items-center justify-center gap-4 bg-white border-2 border-slate-200 hover:border-[#4C4CDD] hover:bg-[#4C4CDD] hover:text-white text-black rounded-2xl transition-all group shadow-sm hover:shadow-xl">
                      <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center group-hover:bg-white transition-colors">
                        <svg className="w-4 h-4 text-slate-400 group-hover:text-[#4C4CDD] animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      </div>
                      <span className="text-[11px] font-black uppercase tracking-widest">Genera con AI</span>
                    </button>
                  </section>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center sticky top-20 space-y-3">
                <div 
                  onMouseDown={handleImageMouseDown}
                  onMouseMove={handleImageMouseMove}
                  onMouseUp={handleImageMouseUp}
                  onMouseLeave={handleImageMouseUp}
                  className={`flex flex-col items-center cursor-pointer group w-full overflow-hidden transition-all ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`} 
                  onClick={() => !isDragging && setIsWidePreview(!isWidePreview)}
                >
                    <div style={{ width: `${isWidePreview ? widePreviewWidth : previewWidth}mm`, height: `${isWidePreview ? widePreviewHeight : previewHeight}mm` }} className="relative overflow-hidden bg-white transition-all duration-300 shadow-xl rounded-sm border">
                        <div className="origin-top-left transition-transform duration-300" style={{ transform: `scale(${isWidePreview ? wideScaleFactor : scaleFactor})` }}>
                            <PagePreview isUiPreview isCover style={state.style} title={state.title} titleFontSize={state.titleFontSize || DEFAULT_TITLE_FONT_SIZE} subtitle={state.subtitle} subtitleFontSize={state.subtitleFontSize || DEFAULT_SUBTITLE_FONT_SIZE} authors={state.authors} authorsFontSize={state.authorsFontSize || DEFAULT_AUTHORS_FONT_SIZE} coverImage={state.coverImage} isCoverImageAiGenerated={state.isCoverImageAiGenerated} coverZoom={state.coverZoom} coverPosition={state.coverPosition} layoutType={state.layoutType} contacts={state.contacts} contactsFontSizeOffset={state.contactsFontSizeOffset} pageIndex={0} />
                        </div>
                    </div>
                    <p className="mt-2 text-[9px] font-black text-slate-700 uppercase group-hover:text-indigo-600 tracking-widest">Clicca per Zoom Anteprima</p>
                </div>

                <section className="w-full max-w-[400px] bg-white p-3 rounded-2xl shadow-lg space-y-2">
                  <div className="flex justify-between items-center border-b pb-1">
                    <h2 className="text-[11px] font-black uppercase tracking-tight text-black">4. INQUADRATURA</h2>
                    <div className="flex gap-1.5 items-center">
                      {isDeletingCover ? (
                        <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-2">
                          <span className="text-[8px] font-black text-red-600 uppercase">Sicuro?</span>
                          <button 
                            onMouseDown={(e) => { 
                              e.preventDefault(); 
                              setState(s => ({...s, coverImage: null, isCoverImageAiGenerated: false}));
                              setIsDeletingCover(false);
                            }} 
                            className="text-[8px] font-black bg-red-600 text-white px-2 py-1 rounded uppercase shadow-sm"
                          >
                            Sì
                          </button>
                          <button 
                            onMouseDown={(e) => { e.preventDefault(); setIsDeletingCover(false); }} 
                            className="text-[8px] font-black bg-slate-200 text-slate-700 px-2 py-1 rounded uppercase shadow-sm"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <>
                          <button 
                            onMouseDown={(e) => { e.preventDefault(); setIsFavoritesOpen(true); }}
                            className="flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 transition-all text-[9px] font-black uppercase tracking-tight"
                          >
                            Preferiti
                          </button>
                          <button 
                            onMouseDown={(e) => { 
                              e.preventDefault(); 
                              if (state.coverImage) {
                                addToFavorites(state.coverImage!); 
                              }
                            }}
                            disabled={!state.coverImage}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all text-[9px] font-black uppercase tracking-tight border ${
                              state.coverImage 
                                ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100' 
                                : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                            }`}
                            title={state.coverImage ? "Aggiungi ai Preferiti" : "Carica o genera prima un'immagine"}
                          >
                            Salva
                          </button>
                          {state.coverImage && (
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); setIsDeletingCover(true); }} 
                              className="text-[9px] font-black text-red-600 uppercase border border-red-100 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                            >
                              Elimina
                            </button>
                          )}
                          <button 
                            onMouseDown={(e) => { e.preventDefault(); resetCover(); }} 
                            className="text-[9px] font-black text-indigo-600 uppercase border border-indigo-100 px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
                          >
                            Ripristina
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                      <div className="space-y-0.5">
                          <label className="text-[9px] font-black text-indigo-600 uppercase flex justify-between items-center">
                            Zoom Immagine 
                            <div className="flex items-center gap-1">
                              <button onMouseDown={(e) => { e.preventDefault(); setState({...state, coverZoom: Math.max(10, state.coverZoom - 5)}); }} className="w-5 h-5 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200">-</button>
                              <input type="number" min="10" max="500" value={state.coverZoom} onChange={e => setState({...state, coverZoom: parseInt(e.target.value) || 10})} className="w-12 text-center text-[10px] font-bold border border-slate-200 rounded py-0.5" />
                              <button onMouseDown={(e) => { e.preventDefault(); setState({...state, coverZoom: Math.min(500, state.coverZoom + 5)}); }} className="w-5 h-5 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200">+</button>
                            </div>
                          </label>
                          <input type="range" min="10" max="500" value={state.coverZoom} onChange={e => setState({...state, coverZoom: parseInt(e.target.value)})} className="w-full h-1 bg-slate-200 accent-indigo-600 appearance-none rounded" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                              <div className="space-y-0.5">
                                  <label className="text-[8px] font-black text-indigo-600 uppercase flex justify-between items-center">
                                    Orizzontale 
                                    <div className="flex items-center gap-1">
                                      <button onMouseDown={(e) => { e.preventDefault(); setState({...state, coverPosition: {...state.coverPosition, x: Math.max(0, state.coverPosition.x - 1)}}); }} className="w-4 h-4 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 text-[10px]">-</button>
                                      <input type="number" min="0" max="100" value={state.coverPosition.x} onChange={e => setState({...state, coverPosition: {...state.coverPosition, x: parseInt(e.target.value) || 0}})} className="w-10 text-center text-[9px] font-bold border border-slate-200 rounded py-0.5" />
                                      <button onMouseDown={(e) => { e.preventDefault(); setState({...state, coverPosition: {...state.coverPosition, x: Math.min(100, state.coverPosition.x + 1)}}); }} className="w-4 h-4 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 text-[10px]">+</button>
                                    </div>
                                  </label>
                                  <input type="range" min="0" max="100" value={state.coverPosition.x} onChange={e => setState({...state, coverPosition: {...state.coverPosition, x: parseInt(e.target.value)}})} className="w-full h-1 accent-indigo-400 rounded" />
                              </div>
                              <button onMouseDown={(e) => { e.preventDefault(); setState({...state, coverPosition: {...state.coverPosition, x: 50}}); }} className="w-full py-1.5 bg-slate-100 text-slate-800 text-[8px] font-black uppercase rounded hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-slate-200">Centra X</button>
                          </div>
                          <div className="space-y-1">
                              <div className="space-y-0.5">
                                  <label className="text-[8px] font-black text-indigo-600 uppercase flex justify-between items-center">
                                    Verticale 
                                    <div className="flex items-center gap-1">
                                      <button onMouseDown={(e) => { e.preventDefault(); setState({...state, coverPosition: {...state.coverPosition, y: Math.max(0, state.coverPosition.y - 1)}}); }} className="w-4 h-4 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 text-[10px]">-</button>
                                      <input type="number" min="0" max="100" value={state.coverPosition.y} onChange={e => setState({...state, coverPosition: {...state.coverPosition, y: parseInt(e.target.value) || 0}})} className="w-10 text-center text-[9px] font-bold border border-slate-200 rounded py-0.5" />
                                      <button onMouseDown={(e) => { e.preventDefault(); setState({...state, coverPosition: {...state.coverPosition, y: Math.min(100, state.coverPosition.y + 1)}}); }} className="w-4 h-4 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 text-[10px]">+</button>
                                    </div>
                                  </label>
                                  <input type="range" min="0" max="100" value={state.coverPosition.y} onChange={e => setState({...state, coverPosition: {...state.coverPosition, y: parseInt(e.target.value)}})} className="w-full h-1 accent-indigo-400 rounded" />
                              </div>
                              <button onMouseDown={(e) => { e.preventDefault(); setState({...state, coverPosition: {...state.coverPosition, y: 50}}); }} className="w-full py-1.5 bg-slate-100 text-slate-800 text-[8px] font-black uppercase rounded hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-slate-200">Centra Y</button>
                          </div>
                      </div>
                  </div>
                </section>
            </div>
          </div>
        )}

        {currentStep === Step.Style && (
          <div className={`grid grid-cols-1 gap-6 md:gap-10 items-start transition-all ${isWidePreview ? 'xl:grid-cols-[450px_1fr]' : 'xl:grid-cols-[1fr_450px]'}`}>
            <div className="bg-white pt-2 pb-2 px-2.5 sm:pt-4 sm:pb-4 sm:px-4 md:pt-5 md:pb-5 md:px-5 rounded-2xl md:rounded-3xl shadow-xl space-y-[8px] md:space-y-[10px] flex flex-col h-full">
              <div className="flex items-center justify-between border-b pb-[6px] mb-2 px-2">
                <h2 className="text-lg md:text-xl font-black uppercase tracking-tight text-black">Design Grafico</h2>
              </div>
              
              <div className={`flex flex-col ${isWidePreview ? 'lg:flex-col' : 'lg:flex-row'} gap-4 lg:gap-6 flex-grow`}>
                {/* 3 Columns for Palettes */}
                <div className={`w-full ${isWidePreview ? 'lg:w-full' : 'lg:w-[82%]'} space-y-4`}>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-[10px] font-black uppercase text-indigo-600 tracking-widest flex items-center gap-2">
                      Seleziona Palette 
                      <span className="px-1.5 py-0.5 bg-indigo-100 rounded-md text-[8px] text-indigo-700">
                        {(state.palettes || PALETTES).length}
                      </span>
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(() => {
                      const currentPalettes = state.palettes || PALETTES;
                      const sortedPalettes = [...currentPalettes].sort((a, b) => {
                        const isAFav = state.favorites?.includes(a.name);
                        const isBFav = state.favorites?.includes(b.name);
                        if (isAFav && !isBFav) return -1;
                        if (!isAFav && isBFav) return 1;
                        return 0;
                      });
                      
                      return sortedPalettes.slice(palettePage * 6, (palettePage + 1) * 6).map(p => {
                        const isFav = state.favorites?.includes(p.name);
                        return (
                          <div key={p.name} className="relative group">
                            <button 
                              onMouseDown={(e) => { e.preventDefault(); setState({...state, style: p.style}); }} 
                              className={`w-full p-1 border-2 rounded-xl transition-all flex flex-col items-center ${state.style.sidebarBg === p.style.sidebarBg ? 'border-indigo-600 bg-indigo-50/50 shadow-md' : 'border-slate-50 hover:border-slate-200 bg-white'}`}
                            >
                              <div className="w-full aspect-video flex rounded-lg overflow-hidden mb-2 shadow-sm border border-slate-100 bg-white relative">
                                {/* Sidebar (30%) */}
                                <div className="w-[30%] h-full flex flex-col pt-[10%] pb-[10%] pr-[10%] pl-[5%] relative z-10" style={{ backgroundColor: p.style.sidebarBg }}>
                                  <div className="montserrat-medium uppercase text-[2.5px] tracking-[0.2em] mb-[15%] whitespace-nowrap overflow-hidden" style={{ color: p.style.sidebarText }}>
                                    Teatro dell'Argine
                                  </div>
                                  <div className="my-auto flex flex-col">
                                    <div className="anton uppercase text-[7px] leading-[1.05] mb-[5%] text-left" style={{ color: p.style.accentColor }}>
                                      Titolo<br/>Progetto
                                    </div>
                                    <div className="montserrat-light uppercase text-[3px] tracking-[0.15em] text-left opacity-80" style={{ color: p.style.sidebarText }}>
                                      Sottotitolo
                                    </div>
                                  </div>
                                </div>
                                <div className="w-[2px] h-full z-20" style={{ backgroundColor: p.style.accentColor }}></div>
                                <div className="flex-1 h-full flex items-center justify-center relative z-10" style={{ backgroundColor: p.style.mainBg }}>
                                  <div className="open-sans italic text-[3.5px] font-medium opacity-20 uppercase tracking-tight" style={{ color: p.style.mainText }}>
                                    Nessuna immagine
                                  </div>
                                </div>
                              </div>
                              <span className="text-[8px] font-black uppercase text-slate-500 truncate w-[70%] text-left pl-1 group-hover:text-slate-900 transition-colors">{p.name}</span>
                              {state.style.sidebarBg === p.style.sidebarBg && (
                                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white">
                                  <Check size={10} strokeWidth={4} />
                                </div>
                              )}
                            </button>
                            
                            {/* Minimalist Icons: Star and Trash */}
                            <div className="absolute bottom-1.5 right-1.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-30">
                              <button
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const newFavs = isFav 
                                    ? (state.favorites || []).filter(f => f !== p.name)
                                    : [...(state.favorites || []), p.name];
                                  setState({...state, favorites: newFavs});
                                }}
                                className={`p-1.5 rounded-lg shadow-md border-2 transition-all hover:scale-110 active:scale-90 ${isFav ? 'bg-amber-500 border-amber-600 text-white' : 'bg-white border-amber-100 text-amber-500 hover:bg-amber-50'}`}
                              >
                                <Star size={11} fill={isFav ? "currentColor" : "none"} strokeWidth={3} />
                              </button>
                              <button
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setPaletteToDelete(p.name);
                                }}
                                className="p-1.5 rounded-lg bg-white border-2 border-red-100 text-red-500 hover:bg-red-50 hover:border-red-200 shadow-md transition-all hover:scale-110 active:scale-90"
                              >
                                <Trash2 size={11} strokeWidth={3} />
                              </button>
                            </div>

                            {/* Confirmation Overlay for Delete */}
                            {paletteToDelete === p.name && (
                              <div className="absolute inset-0 bg-white/95 z-40 flex flex-col items-center justify-center p-2 rounded-xl border-2 border-red-200 animate-in fade-in zoom-in-95">
                                <p className="text-[8px] font-black uppercase text-red-600 mb-2 text-center">Sei sicuro?</p>
                                <div className="flex gap-2">
                                  <button 
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); confirmDeletePalette(p.name); }}
                                    className="px-2 py-1 bg-red-600 text-white text-[7px] font-black uppercase rounded-md shadow-sm"
                                  >
                                    Sì
                                  </button>
                                  <button 
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setPaletteToDelete(null); }}
                                    className="px-2 py-1 bg-slate-200 text-slate-700 text-[7px] font-black uppercase rounded-md shadow-sm"
                                  >
                                    No
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Enhanced Pagination Controls */}
                  {(state.palettes || PALETTES).length > 6 && (
                    <div className="flex flex-col items-center gap-4 pt-3 border-t border-slate-100 mt-1.5">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onMouseDown={(e) => { e.preventDefault(); setPalettePage(0); }}
                          disabled={palettePage === 0}
                          className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all border-2 ${
                            palettePage === 0 
                              ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' 
                              : 'bg-white text-indigo-600 border-indigo-100 hover:border-indigo-600 hover:bg-indigo-600 hover:text-white shadow-sm hover:shadow-indigo-100 active:scale-95'
                          }`}
                          title="Prima pagina"
                        >
                          <ChevronsLeft size={18} strokeWidth={4} />
                        </button>

                        <button 
                          onMouseDown={(e) => { e.preventDefault(); setPalettePage(p => Math.max(0, p - 1)); }}
                          disabled={palettePage === 0}
                          className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all border-2 ${
                            palettePage === 0 
                              ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' 
                              : 'bg-white text-indigo-600 border-indigo-100 hover:border-indigo-600 hover:bg-indigo-600 hover:text-white shadow-sm hover:shadow-indigo-100 active:scale-95'
                          }`}
                          title="Precedente"
                        >
                          <ChevronLeft size={18} strokeWidth={4} />
                        </button>
                        
                        <div className="px-3 py-1.5 bg-[#4C4CDD] text-white rounded-xl text-[9px] font-black tracking-widest shadow-lg border border-indigo-500 min-w-[60px] text-center">
                          {palettePage + 1} / {Math.ceil((state.palettes || PALETTES).length / 6)}
                        </div>

                        <button 
                          onMouseDown={(e) => { e.preventDefault(); setPalettePage(p => Math.min(Math.ceil((state.palettes || PALETTES).length / 6) - 1, p + 1)); }}
                          disabled={palettePage === Math.ceil((state.palettes || PALETTES).length / 6) - 1}
                          className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all border-2 ${
                            palettePage === Math.ceil((state.palettes || PALETTES).length / 6) - 1 
                              ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' 
                              : 'bg-white text-indigo-600 border-indigo-100 hover:border-indigo-600 hover:bg-indigo-600 hover:text-white shadow-sm hover:shadow-indigo-100 active:scale-95'
                          }`}
                          title="Successiva"
                        >
                          <ChevronRight size={18} strokeWidth={4} />
                        </button>

                        <button 
                          onMouseDown={(e) => { e.preventDefault(); setPalettePage(Math.ceil((state.palettes || PALETTES).length / 6) - 1); }}
                          disabled={palettePage === Math.ceil((state.palettes || PALETTES).length / 6) - 1}
                          className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all border-2 ${
                            palettePage === Math.ceil((state.palettes || PALETTES).length / 6) - 1 
                              ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' 
                              : 'bg-white text-indigo-600 border-indigo-100 hover:border-indigo-600 hover:bg-indigo-600 hover:text-white shadow-sm hover:shadow-indigo-100 active:scale-95'
                          }`}
                          title="Ultima pagina"
                        >
                          <ChevronsRight size={18} strokeWidth={4} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Vertical Separator */}
                <div className={`${isWidePreview ? 'hidden' : 'hidden lg:block'} w-px bg-slate-200 self-stretch`}></div>
                <div className={`${isWidePreview ? 'block' : 'block lg:hidden'} h-px bg-slate-200 w-full`}></div>

                {/* Vertical Custom Colors */}
                <div className={`flex-1 space-y-3 ${isWidePreview ? 'pt-1' : 'lg:pl-1'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">Personalizza</h3>
                    {!isAddingPaletteUI && (
                      <button 
                        onMouseDown={(e) => { 
                          e.preventDefault(); 
                          setIsAddingPaletteUI(true); 
                          setNewPaletteName(`Mia Palette ${ (state.palettes || PALETTES).length + 1 }`);
                        }}
                        className="p-1.5 bg-indigo-600 text-white rounded-lg shadow-md hover:bg-indigo-700 transition-all active:scale-95"
                        title="Aggiungi alle Palette"
                      >
                        <Plus size={14} strokeWidth={4} />
                      </button>
                    )}
                  </div>
                  
                  {isAddingPaletteUI && (
                    <div className="mb-4 p-4 bg-indigo-50 rounded-2xl border-2 border-indigo-100 space-y-3 animate-in slide-in-from-top-2">
                      <h4 className="text-[9px] font-black uppercase text-indigo-600">Nome Nuova Palette</h4>
                      <input 
                        type="text" 
                        autoFocus
                        value={newPaletteName}
                        onChange={(e) => setNewPaletteName(e.target.value)}
                        placeholder="Es: Mia Palette Moderna"
                        className="w-full p-3 bg-white border-none rounded-xl text-[11px] shadow-sm focus:ring-2 ring-indigo-500 outline-none"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addNewPalette(newPaletteName);
                          if (e.key === 'Escape') setIsAddingPaletteUI(false);
                        }}
                      />
                      <div className="flex gap-2">
                        <button 
                          onMouseDown={(e) => { e.preventDefault(); addNewPalette(newPaletteName); }}
                          className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest shadow-md"
                        >
                          Salva
                        </button>
                        <button 
                          onMouseDown={(e) => { e.preventDefault(); setIsAddingPaletteUI(false); }}
                          className="flex-1 py-2 bg-white text-slate-500 border border-slate-200 rounded-lg text-[9px] font-black uppercase tracking-widest"
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    {Object.keys(state.style).map(key => (
                      <div key={key} className="flex flex-col gap-1.5 py-2 px-2.5 bg-slate-50 rounded-xl border border-slate-100 shadow-sm group hover:border-indigo-200 transition-colors">
                        <span className="text-[9px] font-black uppercase text-slate-600 truncate tracking-wider">{LABEL_MAP[key] || key}</span>
                        <div className="relative w-full h-[36px] rounded-lg overflow-hidden border-2 border-white shadow-sm ring-1 ring-slate-200">
                          <input 
                            type="color" 
                            value={(state.style as any)[key]} 
                            onChange={e => updateCustomColor(key as any, e.target.value)} 
                            className="absolute inset-0 w-full h-full cursor-pointer scale-[2] origin-center" 
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center sticky top-20 cursor-pointer group space-y-6 w-full overflow-hidden" onClick={() => !isDragging && setIsWidePreview(!isWidePreview)}>
               <div style={{ width: `${isWidePreview ? widePreviewWidth : previewWidth}mm`, height: `${isWidePreview ? widePreviewHeight : previewHeight}mm` }} className="relative overflow-hidden bg-white shadow-xl rounded-sm border transition-all duration-300">
                  <div className="origin-top-left transition-transform duration-300" style={{ transform: `scale(${isWidePreview ? wideScaleFactor : scaleFactor})` }}>
                    <PagePreview isUiPreview isCover style={state.style} title={state.title} titleFontSize={state.titleFontSize || DEFAULT_TITLE_FONT_SIZE} subtitle={state.subtitle} subtitleFontSize={state.subtitleFontSize || DEFAULT_SUBTITLE_FONT_SIZE} authors={state.authors} authorsFontSize={state.authorsFontSize || DEFAULT_AUTHORS_FONT_SIZE} coverImage={state.coverImage} isCoverImageAiGenerated={state.isCoverImageAiGenerated} coverZoom={state.coverZoom} coverPosition={state.coverPosition} layoutType={state.layoutType} contacts={state.contacts} contactsFontSizeOffset={state.contactsFontSizeOffset} pageIndex={0} />
                  </div>
               </div>
               <div style={{ width: `${isWidePreview ? widePreviewWidth : previewWidth}mm`, height: `${isWidePreview ? widePreviewHeight : previewHeight}mm` }} className="relative overflow-hidden bg-white shadow-xl rounded-sm border transition-all duration-300">
                  <div className="origin-top-left transition-transform duration-300" style={{ transform: `scale(${isWidePreview ? wideScaleFactor : scaleFactor})` }}>
                    <PagePreview isUiPreview style={state.style} chapter={{id:'ex', title:'COSA', subtitle:'Anteprima Layout', keywords:['Design','Design','16:9'], content:'Testo esemplificativo per visualizzare la scelta cromatica.'}} pageIndex={1} layoutType={state.layoutType} />
                  </div>
               </div>
               <p className="mt-2 text-[9px] font-black text-slate-700 uppercase group-hover:text-indigo-600 tracking-widest">Clicca per Zoom Anteprima</p>
            </div>
          </div>
        )}

        {currentStep === Step.Content && (
          <div className="max-w-4xl mx-auto space-y-4 pb-6 animate-in fade-in px-4 md:px-0">
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] md:rounded-[3rem] shadow-2xl border border-slate-100 space-y-3">
              <div className="flex items-center justify-between border-b-2 border-slate-50 pb-1.5">
                <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-900">Input Progetto</h2>
              </div>

              {/* 1. Descrizione Progetto */}
              <div className="space-y-2">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-2">
                  Descrivi dettagliatamente il progetto
                </h3>
                <textarea 
                  placeholder="Inserisci o incolla qui i contenuti del tuo dossier teatrale..." 
                  className="w-full h-28 p-5 rounded-3xl bg-slate-50 border-2 border-transparent focus:border-indigo-500/20 focus:bg-white outline-none text-base shadow-inner resize-none transition-all text-slate-900" 
                  value={inputText} 
                  onChange={e => setInputText(e.target.value)} 
                />
              </div>

              {/* 2. Azioni e File (3 Colonne) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Registra */}
                <div className="space-y-2">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-2">
                    Registra
                  </h3>
                  <button 
                    onMouseDown={(e) => { e.preventDefault(); isRecording ? stopRecording() : startRecording(); }} 
                    className={`w-full h-32 rounded-3xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
                      isRecording 
                        ? 'border-red-400 bg-red-50 text-red-600 animate-pulse' 
                        : 'border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 text-slate-600 hover:text-indigo-600'
                    }`}
                  >
                    {isRecording ? (
                      <>
                        <div className="flex items-center gap-1.5 h-6">
                          {[0.5, 0.8, 1.0, 0.7, 0.4].map((scale, i) => (
                            <div 
                              key={i}
                              className="w-1.5 bg-red-500 rounded-full transition-all duration-75" 
                              style={{ height: `${Math.max(6, Math.min(24, (audioLevel / 50) * 24 * scale))}px` }} 
                            />
                          ))}
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest">Ferma</span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-7 h-7" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-center px-2">Registra Audio</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Carica */}
                <div className="space-y-2">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-2">
                    Carica
                  </h3>
                  <button 
                    onMouseDown={(e) => { e.preventDefault(); docInputRef.current?.click(); }} 
                    className="w-full h-32 rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 text-slate-600 hover:text-indigo-600 flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                  >
                    <input 
                      type="file" 
                      ref={docInputRef} 
                      className="hidden" 
                      accept=".doc,.docx,.pdf,.txt,.mp3,.wav,audio/*" 
                      multiple 
                      onChange={handleDocUpload} 
                    />
                    <Upload className="w-7 h-7" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Carica File</span>
                  </button>
                </div>

                {/* File Caricati */}
                <div className="space-y-2">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-2">
                    File Caricati
                  </h3>
                  <div className="bg-slate-50 p-3 rounded-3xl h-32 border-2 border-slate-100 shadow-inner overflow-y-auto custom-scrollbar">
                    {uploadedFileNames.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-1">
                        <FileText className="w-6 h-6 opacity-20" />
                        <p className="text-[8px] font-bold uppercase tracking-[0.1em]">Nessun file</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-1.5">
                        {uploadedFileNames.map((n, i) => (
                          <div key={i} className="flex justify-between items-center bg-white p-2 rounded-xl shadow-sm border border-slate-100 group animate-in slide-in-from-bottom-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-3 h-3 text-indigo-600 shrink-0" />
                              <span className="truncate font-bold text-[9px] text-slate-700">{n}</span>
                            </div>
                            
                            {confirmDeleteFileIndex === i ? (
                              <div className="flex items-center gap-1 bg-red-50 p-0.5 px-1.5 rounded-lg border border-red-100 shrink-0">
                                <button 
                                  onMouseDown={(e) => { e.preventDefault(); removeFile(i); setConfirmDeleteFileIndex(null); }} 
                                  className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[8px] font-black uppercase"
                                >
                                  Sì
                                </button>
                                <button 
                                  onMouseDown={(e) => { e.preventDefault(); setConfirmDeleteFileIndex(null); }} 
                                  className="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded text-[8px] font-black uppercase"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button 
                                onMouseDown={(e) => { e.preventDefault(); setConfirmDeleteFileIndex(i); }} 
                                className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. Azioni Finali */}
              <div className="space-y-3 pt-2">
                <button 
                  onMouseDown={(e) => { 
                    e.preventDefault(); 
                    if(!loading) {
                      if(!inputText.trim()) {
                        showToast("Inserisci del testo o carica dei file per procedere", "error");
                        return;
                      }
                      handleAIAnalysis();
                    }
                  }} 
                  className={`w-full h-14 rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-3 transition-all duration-300 active:scale-[0.98] cursor-pointer
                    ${loading 
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                      : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-500/25 hover:-translate-y-0.5'
                    }
                  `}
                >
                  {loading ? (
                    <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-5 h-5" />
                  )}
                  <span>Organizza con l'AI</span>
                </button>

                <div className="flex justify-center">
                  <button 
                    onMouseDown={(e) => { e.preventDefault(); handleSkipAI(); }} 
                    className="text-slate-400 hover:text-indigo-600 font-bold text-[10px] uppercase tracking-widest transition-colors flex items-center gap-2 group"
                  >
                    <span>Grazie ma ho già i testi</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === Step.Editor && (
          <div className="max-w-[1700px] mx-auto space-y-8 md:space-y-12 pb-20 px-2 md:px-0">
             <div className="flex flex-col md:flex-row justify-between items-center border-b pb-6 md:pb-8 gap-4">
               <div className="flex items-center gap-4">
                 <h2 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-black">Revisione Contenuti</h2>
               </div>
               <div className="flex gap-4 w-full md:w-auto">
                 <button onMouseDown={(e) => { e.preventDefault(); setIsAddingPage(true); }} className="flex-1 md:flex-none px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-black uppercase shadow-lg hover:bg-indigo-600 transition-all">Nuova Pagina</button>
               </div>
             </div>
             {isAddingPage && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 md:p-10 max-w-md w-full space-y-6 animate-in zoom-in-95 shadow-2xl">
                        <h3 className="text-xl font-black uppercase text-black">Titolo Pagina</h3>
                        <input id="new-page-title" className="w-full p-4 rounded-xl border-2 outline-none focus:border-indigo-600 text-slate-900" />
                        <div className="flex gap-4"><button onMouseDown={(e) => { e.preventDefault(); setIsAddingPage(false); }} className="flex-1 py-4 border rounded-xl font-black text-xs uppercase text-slate-700">Annulla</button><button onMouseDown={(e) => { e.preventDefault(); const val = (document.getElementById('new-page-title') as HTMLInputElement).value || "PAGINA"; setState(s => ({ ...s, chapters: [...s.chapters, { id: `ch-${Date.now()}`, title: val.toUpperCase(), subtitle: "", keywords: [], content: "", image: null, imageZoom: 100, imagePosition: { x: 50, y: 50 } }] })); setIsAddingPage(false); }} className="flex-1 py-4 bg-indigo-600 text-white font-black text-xs uppercase">Aggiungi</button></div>
                    </div>
                </div>
             )}
             <div className="space-y-16">
              {state.chapters.map((ch, i) => {
                const isContacts = ch.id.includes('chapter-contacts') || ch.title.toUpperCase() === 'CONTATTI';
                return (
                  <div key={ch.id} className={`grid grid-cols-1 gap-10 items-start transition-all ${isWidePreview ? 'xl:grid-cols-[450px_1fr]' : 'xl:grid-cols-[1fr_450px]'}`}>
                    <div className="bg-white p-6 md:p-8 rounded-3xl shadow-xl border-l-8 border-indigo-600 space-y-6">
                      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                          <div className="flex-grow flex flex-col space-y-1.5">
                            <div className="flex items-center gap-3">
                              <label className="text-[9px] font-black uppercase text-indigo-600 tracking-widest pl-1">Titolo Pagina</label>
                              <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5">
                                <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, chapters: s.chapters.map(chapter => chapter.id === ch.id ? {...chapter, titleFontSize: Math.max(10, (chapter.titleFontSize ?? 53.33) - 1)} : chapter)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Rimpicciolisce Titolo">-</button>
                                <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, chapters: s.chapters.map(chapter => chapter.id === ch.id ? {...chapter, titleFontSize: Math.min(250, (chapter.titleFontSize ?? 53.33) + 1)} : chapter)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Ingrandisce Titolo">+</button>
                                <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, chapters: s.chapters.map(chapter => chapter.id === ch.id ? {...chapter, titleFontSize: 53.33} : chapter)})); }} className="ml-1 w-5 h-5 flex items-center justify-center hover:bg-indigo-600 hover:text-white rounded transition-colors text-[8px] font-black text-indigo-600 border border-indigo-200" title="Ripristina Titolo">R</button>
                              </div>
                            </div>
                            <input className="text-xl md:text-2xl font-black text-indigo-600 uppercase w-full bg-slate-50 p-3 rounded-xl border-none outline-none focus:ring-2 ring-indigo-500/10" value={ch.title} onChange={e => { 
                              const val = e.target.value.toUpperCase();
                              setState(prev => ({
                                ...prev,
                                chapters: prev.chapters.map(chapter => chapter.id === ch.id ? { ...chapter, title: val } : chapter)
                              }));
                            }} />
                          </div>
                          
                          <div className="flex gap-2 items-center self-end md:self-center">
                            {ch.isConfirmingDelete ? (
                              <div className="flex items-center gap-3 bg-red-50 p-2 px-4 rounded-xl border border-red-200 animate-in fade-in zoom-in-95">
                                <span className="text-[11px] font-black text-red-600 uppercase tracking-tight">Eliminare. Sei sicuro?</span>
                                <div className="flex gap-2">
                                  <button onMouseDown={(e) => { e.preventDefault(); deleteChapter(ch.id); }} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-red-700 transition-colors">Sì</button>
                                  <button onMouseDown={(e) => { e.preventDefault(); toggleDeleteConfirmation(ch.id, false); }} className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-[10px] font-black uppercase hover:bg-slate-300 transition-colors">No</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button disabled={i === 0} onMouseDown={(e) => { e.preventDefault(); moveChapter(ch.id, 'up'); }} className="p-3 bg-slate-100 rounded-xl hover:bg-slate-200 disabled:opacity-30 transition-colors">↑</button>
                                <button disabled={i === state.chapters.length - 1} onMouseDown={(e) => { e.preventDefault(); moveChapter(ch.id, 'down'); }} className="p-3 bg-slate-100 rounded-xl hover:bg-slate-200 disabled:opacity-30 transition-colors">↓</button>
                                <button onMouseDown={(e) => { e.preventDefault(); toggleDeleteConfirmation(ch.id, true); }} className="p-3 bg-red-100 text-red-500 rounded-xl font-black hover:bg-red-200 transition-colors">×</button>
                              </div>
                            )}
                          </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <label className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">Sottotitolo</label>
                          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5">
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, chapters: s.chapters.map(chapter => chapter.id === ch.id ? {...chapter, subtitleFontSize: Math.max(8, (chapter.subtitleFontSize ?? 16) - 0.5)} : chapter)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Rimpicciolisce Sottotitolo">-</button>
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, chapters: s.chapters.map(chapter => chapter.id === ch.id ? {...chapter, subtitleFontSize: Math.min(60, (chapter.subtitleFontSize ?? 16) + 0.5)} : chapter)})); }} className="w-5 h-5 flex items-center justify-center hover:bg-white rounded transition-colors text-[10px] font-black text-indigo-600 shadow-sm" title="Ingrandisce Sottotitolo">+</button>
                            <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({...s, chapters: s.chapters.map(chapter => chapter.id === ch.id ? {...chapter, subtitleFontSize: 16} : chapter)})); }} className="ml-1 w-5 h-5 flex items-center justify-center hover:bg-indigo-600 hover:text-white rounded transition-colors text-[8px] font-black text-indigo-600 border border-indigo-200" title="Ripristina Sottotitolo">R</button>
                          </div>
                        </div>
                        <input className="w-full text-lg font-bold border-b p-2 outline-none focus:border-indigo-600 transition-colors text-slate-900" value={ch.subtitle} onChange={e => { 
                          const val = e.target.value;
                          setState(prev => ({
                            ...prev,
                            chapters: prev.chapters.map(chapter => chapter.id === ch.id ? { ...chapter, subtitle: val } : chapter)
                          }));
                        }} />
                      </div>
                      <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">Tags / Concetti Chiave</label>
                          <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                              {ch.keywords.map((kw, kwIdx) => (<div key={kwIdx} className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border text-[11px] font-black shadow-sm"><input className="outline-none w-24 bg-transparent text-slate-900" value={kw} onChange={e => { 
                                const val = e.target.value;
                                setState(prev => ({
                                  ...prev,
                                  chapters: prev.chapters.map(chapter => {
                                    if (chapter.id === ch.id) {
                                      const newKw = [...chapter.keywords];
                                      newKw[kwIdx] = val;
                                      return { ...chapter, keywords: newKw };
                                    }
                                    return chapter;
                                  })
                                }));
                              }} /><button onMouseDown={(e) => { e.preventDefault(); 
                                setState(prev => ({
                                  ...prev,
                                  chapters: prev.chapters.map(chapter => {
                                    if (chapter.id === ch.id) {
                                      const newKw = chapter.keywords.filter((_, idx) => idx !== kwIdx);
                                      return { ...chapter, keywords: newKw };
                                    }
                                    return chapter;
                                  })
                                }));
                              }} className="text-red-400 hover:text-red-600 transition-colors">×</button></div>))}
                              <button onMouseDown={(e) => { e.preventDefault(); 
                                setState(prev => ({
                                  ...prev,
                                  chapters: prev.chapters.map(chapter => {
                                    if (chapter.id === ch.id) {
                                      return { ...chapter, keywords: [...chapter.keywords, "TAG"] };
                                    }
                                    return chapter;
                                  })
                                }));
                              }} className="px-3 py-1 border border-dashed rounded-lg text-[10px] font-black text-indigo-600 hover:border-indigo-400 hover:text-indigo-600 transition-all">+ NUOVO TAG</button>
                          </div>
                      </div>
                      {isContacts ? (
                        <div className="space-y-4 pt-4 border-t">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <label className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">Referenti Progetti</label>
                              <div className="flex items-center bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                                <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({ ...s, contactsFontSizeOffset: (s.contactsFontSizeOffset || 0) - 1 })); }} className="px-2 py-1 text-[10px] font-black hover:bg-slate-200 transition-colors border-r border-slate-200" title="Riduci testo">-</button>
                                <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({ ...s, contactsFontSizeOffset: 0 })); }} className="px-2 py-1 text-[9px] font-black hover:bg-slate-200 transition-colors border-r border-slate-200 text-indigo-600" title="Ripristina testo">R</button>
                                <button onMouseDown={(e) => { e.preventDefault(); setState(s => ({ ...s, contactsFontSizeOffset: (s.contactsFontSizeOffset || 0) + 1 })); }} className="px-2 py-1 text-[10px] font-black hover:bg-slate-200 transition-colors" title="Ingrandisci testo">+</button>
                              </div>
                            </div>
                            <div className="relative">
                              <button onMouseDown={(e) => { e.preventDefault(); setIsRecentContactsOpen(!isRecentContactsOpen); setConfirmDeleteIndex(null); }} className="text-[9px] font-black text-indigo-600 uppercase border border-indigo-100 px-2 py-1 rounded-lg hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-1.5 shadow-sm group">
                                <Star className="w-2.5 h-2.5 fill-current" />
                                Preferiti <span className="text-[8px] opacity-70 group-hover:opacity-100">▼</span>
                              </button>
                              {isRecentContactsOpen && (
                                <>
                                  <div className="fixed inset-0 z-40" onMouseDown={() => setIsRecentContactsOpen(false)}></div>
                                  <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 shadow-2xl rounded-xl w-[320px] md:w-[450px] max-w-[90vw] max-h-[400px] overflow-y-auto overflow-x-auto animate-in fade-in zoom-in-95 no-scrollbar md:scrollbar-thin">
                                    <div className="p-2 border-b bg-slate-50 text-[8px] font-black text-slate-400 uppercase tracking-widest flex justify-between items-center">
                                      <span>Seleziona per aggiungere</span>
                                      <span className="md:hidden text-[7px] text-indigo-400 animate-pulse">Scorri →</span>
                                    </div>
                                    <div className="min-w-full w-max">
                                      {recentContacts.length === 0 ? (
                                        <div className="p-6 text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                                          Nessun contatto preferito salvato
                                        </div>
                                      ) : (
                                        recentContacts.map((rc, i) => (
                                          <div key={i} className="flex items-stretch border-b last:border-0 group/item min-w-full">
                                            <button onMouseDown={(e) => { e.preventDefault(); addFromRecent(rc); setIsRecentContactsOpen(false); }} className="flex-1 text-left p-3 text-[10px] hover:bg-indigo-50 transition-colors group whitespace-nowrap pr-10">
                                              <div className="font-bold text-slate-900 group-hover:text-indigo-600">{rc.name}</div>
                                              {rc.role && <div className="text-indigo-500 text-[9px] italic">{rc.role}</div>}
                                              <div className="text-slate-500 text-[9px]">{rc.email}</div>
                                              {rc.phone && <div className="text-slate-400 text-[8px]">{rc.phone}</div>}
                                            </button>
                                            <div className="sticky right-0 flex items-stretch">
                                              {confirmDeleteIndex === i ? (
                                                <div className="flex bg-red-600 text-white animate-in slide-in-from-right-full duration-200">
                                                  <button 
                                                    onMouseDown={(e) => { e.preventDefault(); removeFromRecentContacts(i); setConfirmDeleteIndex(null); }}
                                                    className="px-3 text-[8px] font-black uppercase hover:bg-red-700 transition-colors border-r border-red-500"
                                                  >
                                                    Sì
                                                  </button>
                                                  <button 
                                                    onMouseDown={(e) => { e.preventDefault(); setConfirmDeleteIndex(null); }}
                                                    className="px-3 text-[8px] font-black uppercase hover:bg-red-700 transition-colors"
                                                  >
                                                    No
                                                  </button>
                                                </div>
                                              ) : (
                                                <button 
                                                  onMouseDown={(e) => { e.preventDefault(); setConfirmDeleteIndex(i); }}
                                                  className="px-4 bg-red-50 text-red-500 hover:bg-red-600 hover:text-white transition-all border-l border-red-100 shadow-[-10px_0_15px_rgba(239,68,68,0.1)] flex items-center justify-center"
                                                  title="Rimuovi dai preferiti"
                                                >
                                                  <span className="text-lg font-bold">×</span>
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="space-y-3">{state.contacts.map((contact, cIdx) => (
                            <div key={cIdx} className="p-4 bg-slate-50 rounded-xl border relative group animate-in slide-in-from-top-2">
                              <div className="absolute -top-2 -right-2 flex gap-1 z-10">
                                <button onClick={(e) => { e.preventDefault(); saveToRecentContacts(contact); }} title="Salva nei preferiti" className="w-6 h-6 bg-emerald-500 text-white rounded-full text-[10px] font-bold hidden group-hover:flex items-center justify-center shadow-lg">★</button>
                                {contactToDelete === cIdx ? (
                                  <div className="flex bg-red-600 text-white rounded-full overflow-hidden shadow-lg animate-in zoom-in-95">
                                    <button onClick={(e) => { e.preventDefault(); removeContact(cIdx); setContactToDelete(null); }} className="px-2 py-1 text-[8px] font-black uppercase hover:bg-red-700 border-r border-red-500">Sì</button>
                                    <button onClick={(e) => { e.preventDefault(); setContactToDelete(null); }} className="px-2 py-1 text-[8px] font-black uppercase hover:bg-red-700">No</button>
                                  </div>
                                ) : (
                                  <button onClick={(e) => { e.preventDefault(); setContactToDelete(cIdx); }} title="Rimuovi" className="w-6 h-6 bg-red-500 text-white rounded-full text-[10px] font-bold hidden group-hover:flex items-center justify-center shadow-lg">×</button>
                                )}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                        <input placeholder="Nome Cognome" className="md:col-span-3 p-2 text-xs border rounded bg-white outline-none focus:border-indigo-500 text-slate-900" value={contact.name} onChange={(e) => updateContact(cIdx, 'name', e.target.value)} />
                        <input placeholder="Qualifica (es. Organizzazione)" className="md:col-span-3 p-2 text-xs border rounded bg-white outline-none focus:border-indigo-500 text-slate-900" value={contact.role || ''} onChange={(e) => updateContact(cIdx, 'role', e.target.value)} />
                        <input placeholder="Email" className="md:col-span-4 p-2 text-xs border rounded bg-white outline-none focus:border-indigo-500 text-slate-900" value={contact.email} onChange={(e) => updateContact(cIdx, 'email', e.target.value)} />
                        <input 
                            placeholder="+39 xxx xxxxxxxx" 
                            className="md:col-span-2 p-2 text-xs border rounded bg-white outline-none focus:border-indigo-500 text-slate-900" 
                            value={contact.phone} 
                            onChange={(e) => {
                                let val = e.target.value;
                                
                                // Se l'utente cancella tutto o parte del prefisso, lo ripristiniamo
                                if (!val.startsWith('+39 ')) {
                                    // Puliamo input da vecchi prefissi parziali e rimettiamo quello standard
                                    const cleanInput = val.replace(/^\+39\s*/, '').replace(/^\+39/, '').replace(/^\+/, '');
                                    val = '+39 ' + cleanInput;
                                }
                                
                                // Estraiamo solo i numeri dopo il prefisso "+39 "
                                let digits = val.substring(4).replace(/\D/g, '');
                                
                                // Limite a 11 cifre (3 prefisso + 8-10 numero)
                                digits = digits.substring(0, 11);
                                
                                // Formattazione: +39 xxx xxxxxxxx
                                let formatted = '+39 ';
                                if (digits.length > 3) {
                                    formatted += digits.substring(0, 3) + ' ' + digits.substring(3);
                                } else {
                                    formatted += digits;
                                }
                                
                                updateContact(cIdx, 'phone', formatted);
                            }} 
                        /></div></div>))}</div><button onMouseDown={(e) => { e.preventDefault(); addContact(); }} className="w-full py-4 border-2 border-dashed border-slate-200 text-indigo-600 font-black uppercase text-[10px] rounded-xl hover:bg-indigo-50 transition-all mt-2">Aggiungi Referente</button></div>
                      ) : (
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">Testo Principale</label>
                            <RichTextEditor 
                                initialValue={ch.content} 
                                onChange={(val) => { 
                                  setState(prev => {
                                    const newChapters = prev.chapters.map(chapter => 
                                        chapter.id === ch.id ? { ...chapter, content: val } : chapter
                                    );
                                    return { ...prev, chapters: newChapters };
                                  });
                                }} 
                                onImageUpload={() => {
                                  activeChapterIndexForImage.current = i;
                                  chapterImageInputRef.current?.click();
                                }}
                                onGenerateMeta={(text) => handleGenerateMeta(ch.id, text)}
                                isGeneratingMeta={generatingMetaForChapterId === ch.id}
                            />
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-center sticky top-24 space-y-6 w-full md:w-auto overflow-hidden">
                      <div className="flex flex-col items-center cursor-pointer group" onClick={() => !isDragging && setIsWidePreview(!isWidePreview)}>
                        <div style={{ width: `${isWidePreview ? widePreviewWidth : previewWidth}mm`, height: `${isWidePreview ? widePreviewHeight : previewHeight}mm` }} className="relative overflow-hidden bg-white transition-all duration-300 rounded-sm shadow-xl border">
                          <div className="origin-top-left transition-transform duration-300" style={{ transform: `scale(${isWidePreview ? wideScaleFactor : scaleFactor})` }}>
                            <PagePreview isUiPreview style={state.style} title={state.title} chapter={ch} pageIndex={i+1} layoutType={state.layoutType} contacts={state.contacts} contactsFontSizeOffset={state.contactsFontSizeOffset} />
                          </div>
                        </div>
                        <p className="mt-2 text-[9px] font-black text-slate-700 uppercase group-hover:text-indigo-600 tracking-widest">Clicca per Zoom Anteprima</p>
                      </div>

                      {ch.image && !isContacts && (
                        <section className="w-full max-w-[400px] bg-white p-6 rounded-2xl shadow-lg space-y-6 animate-in fade-in slide-in-from-bottom-4">
                          <div className="flex justify-between items-center border-b pb-2">
                            <h2 className="text-sm font-black uppercase tracking-tight text-black">3. Inquadratura</h2>
                            <div className="flex gap-2">
                              <button onMouseDown={(e) => { e.preventDefault(); updateChapterImageConfig(ch.id, { imageZoom: 100, imagePosition: { x: 50, y: 50 } }); }} className="text-[10px] font-black text-indigo-600 uppercase border border-indigo-100 px-3 py-1 rounded-lg hover:bg-indigo-50 transition-colors"> Ripristina </button>
                              <button onMouseDown={(e) => { e.preventDefault(); updateChapterImageConfig(ch.id, { image: null }); }} className="text-[10px] font-black text-red-500 uppercase border border-red-100 px-3 py-1 rounded-lg hover:bg-red-50 transition-colors"> Elimina </button>
                            </div>
                          </div>
                          <div className="space-y-6">
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-indigo-600 uppercase flex justify-between items-center">
                                Zoom
                                <div className="flex items-center gap-1">
                                  <button onMouseDown={(e) => { e.preventDefault(); updateChapterImageConfig(ch.id, { imageZoom: Math.max(10, (ch.imageZoom || 100) - 5) }); }} className="w-5 h-5 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200">-</button>
                                  <input type="number" min="10" max="500" value={ch.imageZoom || 100} onChange={e => updateChapterImageConfig(ch.id, { imageZoom: parseInt(e.target.value) || 10 })} className="w-12 text-center text-[10px] font-bold border border-slate-200 rounded py-0.5" />
                                  <button onMouseDown={(e) => { e.preventDefault(); updateChapterImageConfig(ch.id, { imageZoom: Math.min(500, (ch.imageZoom || 100) + 5) }); }} className="w-5 h-5 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200">+</button>
                                </div>
                              </label>
                              <input type="range" min="10" max="500" value={ch.imageZoom} onChange={e => updateChapterImageConfig(ch.id, { imageZoom: parseInt(e.target.value) })} className="w-full h-1 bg-slate-200 accent-indigo-600 appearance-none rounded" />
                            </div>
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <label className="text-[9px] font-black text-indigo-600 uppercase flex justify-between items-center">
                                      X
                                      <div className="flex items-center gap-1">
                                        <button onMouseDown={(e) => { e.preventDefault(); updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition!, x: Math.max(0, (ch.imagePosition?.x || 50) - 1) } }); }} className="w-4 h-4 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 text-[10px]">-</button>
                                        <input type="number" min="0" max="100" value={ch.imagePosition?.x || 50} onChange={e => updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition!, x: parseInt(e.target.value) || 0 } })} className="w-10 text-center text-[9px] font-bold border border-slate-200 rounded py-0.5" />
                                        <button onMouseDown={(e) => { e.preventDefault(); updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition!, x: Math.min(100, (ch.imagePosition?.x || 50) + 1) } }); }} className="w-4 h-4 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 text-[10px]">+</button>
                                      </div>
                                    </label>
                                    <input type="range" min="0" max="100" value={ch.imagePosition?.x} onChange={e => updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition!, x: parseInt(e.target.value) } })} className="w-full h-1 accent-indigo-400 rounded" />
                                  </div>
                                  <button onMouseDown={(e) => { e.preventDefault(); if (ch.imagePosition) updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition, x: 50 } }); }} className="w-full py-2 bg-slate-100 text-slate-800 text-[9px] font-black uppercase rounded hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-slate-200">Centra Orizz.</button>
                                </div>
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <label className="text-[9px] font-black text-indigo-600 uppercase flex justify-between items-center">
                                      Y
                                      <div className="flex items-center gap-1">
                                        <button onMouseDown={(e) => { e.preventDefault(); updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition!, y: Math.max(0, (ch.imagePosition?.y || 50) - 1) } }); }} className="w-4 h-4 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 text-[10px]">-</button>
                                        <input type="number" min="0" max="100" value={ch.imagePosition?.y || 50} onChange={e => updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition!, y: parseInt(e.target.value) || 0 } })} className="w-10 text-center text-[9px] font-bold border border-slate-200 rounded py-0.5" />
                                        <button onMouseDown={(e) => { e.preventDefault(); updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition!, y: Math.min(100, (ch.imagePosition?.y || 50) + 1) } }); }} className="w-4 h-4 flex items-center justify-center bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 text-[10px]">+</button>
                                      </div>
                                    </label>
                                    <input type="range" min="0" max="100" value={ch.imagePosition?.y} onChange={e => updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition!, y: parseInt(e.target.value) } })} className="w-full h-1 accent-indigo-400 rounded" />
                                  </div>
                                  <button onMouseDown={(e) => { e.preventDefault(); if (ch.imagePosition) updateChapterImageConfig(ch.id, { imagePosition: { ...ch.imagePosition, y: 50 } }); }} className="w-full py-2 bg-slate-100 text-slate-800 text-[9px] font-black uppercase rounded hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-slate-200">Centra Vert.</button>
                                </div>
                            </div>
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                );
              })}
             </div>
          </div>
        )}

        {currentStep === Step.Preview && (
          <div className="max-w-[1400px] mx-auto space-y-6 pb-16 px-2 md:px-0">
            {/* Header Section */}
            <div className="bg-slate-900 px-6 py-2 md:px-10 md:py-3 rounded-2xl md:rounded-[2.5rem] text-white shadow-2xl no-print mb-8">
              <div className="flex flex-col lg:flex-row justify-between items-center gap-6">
                <div className="space-y-1 text-center lg:text-left">
                  <div className="flex items-center justify-center lg:justify-start gap-4">
                    <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">Progetto Concluso</h2>
                  </div>
                  <p className="text-slate-400 text-xs md:text-sm font-medium">Il tuo dossier è pronto per essere scaricato.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                  <button onMouseDown={(e) => { e.preventDefault(); exportProject(); }} className="flex-1 bg-slate-800 text-white px-6 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl hover:bg-slate-700 transition-all text-center border border-slate-700">Salva Progetto</button>
                  <button onMouseDown={(e) => { e.preventDefault(); exportToPPTX(); }} className="flex-1 bg-white text-slate-900 px-6 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl hover:bg-slate-100 transition-all text-center">Esporta PPTX</button>
                  <button onMouseDown={(e) => { e.preventDefault(); setIsPdfModalOpen(true); }} className="flex-1 bg-indigo-600 text-white px-6 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl hover:scale-105 transition-all hover:bg-indigo-500 text-center">Esporta PDF</button>
                </div>
              </div>
            </div>
            
            {isPdfModalOpen && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-8 max-w-lg w-full space-y-8 animate-in zoom-in-95 shadow-2xl">
                  <div className="flex justify-between items-center border-b pb-4">
                    <h3 className="text-2xl font-black uppercase tracking-tight text-black">Impostazioni Esportazione</h3>
                    <button onMouseDown={(e) => { e.preventDefault(); setIsPdfModalOpen(false); }} className="text-slate-400 hover:text-slate-900 text-2xl font-bold">×</button>
                  </div>
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">Qualità Immagini PDF</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button onMouseDown={(e) => { e.preventDefault(); setPdfQuality('standard'); }} className={`py-4 rounded-2xl border-2 font-black uppercase text-xs transition-all ${pdfQuality === 'standard' ? 'border-indigo-600 bg-indigo-50 text-indigo-600' : 'border-slate-100 bg-slate-50 text-slate-700'}`}>Standard</button>
                        <button onMouseDown={(e) => { e.preventDefault(); setPdfQuality('high'); }} className={`py-4 rounded-2xl border-2 font-black uppercase text-xs transition-all ${pdfQuality === 'high' ? 'border-indigo-600 bg-indigo-50 text-indigo-600' : 'border-slate-100 bg-slate-50 text-slate-700'}`}>Alta Qualità</button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase text-indigo-600 tracking-widest">Intervallo Pagine</label>
                      <input type="text" placeholder="es. all oppure 1, 3-5, 7" className="w-full p-4 rounded-2xl bg-slate-50 border-2 border-slate-100 focus:border-indigo-600 outline-none font-bold text-sm text-slate-900" value={pdfPageRange} onChange={(e) => setPdfPageRange(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex gap-4 pt-4">
                    <button onMouseDown={(e) => { e.preventDefault(); setIsPdfModalOpen(false); }} className="flex-1 py-4 border-2 rounded-2xl font-black text-xs uppercase text-slate-700">Annulla</button>
                    <button onMouseDown={(e) => { e.preventDefault(); handleSaveAsPDF(); }} className="flex-1 py-4 bg-indigo-600 text-white font-black text-xs uppercase rounded-2xl shadow-xl hover:bg-indigo-700">Download PDF</button>
                  </div>
                </div>
              </div>
            )}

            <div 
              id="pdf-content" 
              className="flex flex-col items-center gap-0 bg-transparent preview-gap w-full overflow-hidden relative"
              onTouchStart={(e) => {
                if (e.touches.length === 2) {
                  const dist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                  );
                  (e.currentTarget as any)._initialDist = dist;
                  (e.currentTarget as any)._initialZoom = userPreviewZoom;
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length === 2 && (e.currentTarget as any)._initialDist) {
                  e.preventDefault(); // Prevent scrolling while pinching
                  const dist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                  );
                  const scale = dist / (e.currentTarget as any)._initialDist;
                  const newZoom = Math.min(3, Math.max(0.2, (e.currentTarget as any)._initialZoom * scale));
                  setUserPreviewZoom(newZoom);
                }
              }}
              onTouchEnd={(e) => {
                (e.currentTarget as any)._initialDist = null;
              }}
            >
              {/* Floating Zoom Control for All Devices - Collapsible */}
              <div className="fixed bottom-10 right-6 md:right-10 z-[60] flex flex-col items-end gap-2 no-print">
                {isFloatingZoomOpen && (
                  <div className="flex flex-col gap-1.5 animate-in slide-in-from-bottom-4 fade-in duration-200">
                    <button 
                      onMouseDown={(e) => { e.preventDefault(); setUserPreviewZoom(prev => Math.min(3, prev + 0.1)); }}
                      className="w-10 h-10 bg-slate-900/90 backdrop-blur-sm border border-white/10 rounded-full shadow-2xl flex items-center justify-center text-white font-bold text-lg active:scale-90 transition-all"
                    >
                      +
                    </button>
                    <div className="bg-slate-900/90 backdrop-blur-sm border border-white/10 rounded-full shadow-2xl px-2 py-1 text-[9px] font-black text-center text-white">
                      {Math.round(userPreviewZoom * 100)}%
                    </div>
                    <button 
                      onMouseDown={(e) => { e.preventDefault(); setUserPreviewZoom(prev => Math.max(0.2, prev - 0.1)); }}
                      className="w-10 h-10 bg-slate-900/90 backdrop-blur-sm border border-white/10 rounded-full shadow-2xl flex items-center justify-center text-white font-bold text-lg active:scale-90 transition-all"
                    >
                      -
                    </button>
                    <button 
                      onMouseDown={(e) => { e.preventDefault(); setUserPreviewZoom(1); }}
                      className="w-10 h-10 bg-indigo-600/90 backdrop-blur-sm border border-indigo-500/30 rounded-full shadow-2xl flex items-center justify-center text-white font-black text-[8px] uppercase active:scale-90 transition-all"
                    >
                      1:1
                    </button>
                  </div>
                )}
                <button 
                  onMouseDown={(e) => { e.preventDefault(); setIsFloatingZoomOpen(!isFloatingZoomOpen); }}
                  className={`w-12 h-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 ${isFloatingZoomOpen ? 'bg-white text-slate-900' : 'bg-indigo-600 text-white'}`}
                >
                  {isFloatingZoomOpen ? (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 10h6" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 7v6m3-3H7" />
                    </svg>
                  )}
                </button>
              </div>

              <div className="md:hidden text-center mb-4 no-print">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pizzica con due dita per lo zoom</p>
              </div>

              <div 
                className="flex justify-center w-full overflow-hidden" 
                style={{ height: `${finalPreviewHeightMm}mm`, marginBottom: windowWidth < 768 ? '20px' : '40px' }}
              >
                <div 
                  className="origin-top shrink-0" 
                  style={{ transform: `scale(${finalScaleFactor})`, width: '338.67mm', height: '190.5mm' }}
                >
                  <div className="page-wrapper shrink-0">
                    <PagePreview style={state.style} isCover title={state.title} titleFontSize={state.titleFontSize || DEFAULT_TITLE_FONT_SIZE} subtitle={state.subtitle} subtitleFontSize={state.subtitleFontSize || DEFAULT_SUBTITLE_FONT_SIZE} authors={state.authors} authorsFontSize={state.authorsFontSize || DEFAULT_AUTHORS_FONT_SIZE} coverImage={state.coverImage} isCoverImageAiGenerated={state.isCoverImageAiGenerated} coverZoom={state.coverZoom} coverPosition={state.coverPosition} layoutType={state.layoutType} contacts={state.contacts} contactsFontSizeOffset={state.contactsFontSizeOffset} pageIndex={0} />
                  </div>
                </div>
              </div>

              {state.chapters.map((ch, i) => (
                <div 
                  key={ch.id} 
                  className="flex justify-center w-full overflow-hidden" 
                  style={{ height: `${finalPreviewHeightMm}mm`, marginBottom: windowWidth < 768 ? '20px' : '40px' }}
                >
                  <div 
                    className="origin-top shrink-0" 
                    style={{ transform: `scale(${finalScaleFactor})`, width: '338.67mm', height: '190.5mm' }}
                  >
                    <div className="page-wrapper shrink-0">
                      <PagePreview style={state.style} title={state.title} chapter={ch} pageIndex={i+1} layoutType={state.layoutType} contacts={state.contacts} contactsFontSizeOffset={state.contactsFontSizeOffset} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-slate-900 text-white py-2 no-print z-50 border-t border-slate-800 shadow-2xl">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 flex justify-between items-center relative">
          <button 
            onMouseDown={(e) => { e.preventDefault(); if(currentStep !== Step.Selection) handleBack(); }} 
            className={`w-12 h-12 flex items-center justify-center bg-slate-700 text-white rounded-full shadow-lg hover:bg-slate-600 transition-all active:scale-90 ${currentStep === Step.Selection ? 'invisible' : ''}`}
            title="Indietro"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          
          {/* Desktop Actions */}
          <div className="hidden lg:flex items-center gap-3">
             <button 
               onClick={(e) => { e.stopPropagation(); createManualRestorePoint(); }}
               className="px-4 py-2 bg-white text-slate-900 hover:bg-slate-100 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all shadow-lg border border-slate-200"
               title="Crea punto di ripristino manuale"
             >
               Salva Punto di Ripristino
             </button>

             <button 
               onClick={(e) => { e.stopPropagation(); openHistory(); }}
               className="px-4 py-2 bg-white text-slate-900 hover:bg-slate-100 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all shadow-lg border-[3px] border-red-600"
               title="Vedi cronologia"
             >
               Cronologia Punti di Ripristino
             </button>

             <button 
               onClick={(e) => { e.stopPropagation(); projectInputRef.current?.click(); }}
               className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-500 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all shadow-lg border border-blue-500/50"
               title="Carica un file di progetto (.json)"
             >
               Carica File Progetto
             </button>

             <button 
               onClick={(e) => { e.stopPropagation(); exportProject(); }}
               className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-500 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all shadow-lg border border-blue-500/50"
               title="Scarica il file di progetto (.json)"
             >
               Salva File Progetto
             </button>
          </div>

          {/* Mobile/Tablet Actions Menu */}
          <div className="lg:hidden flex items-center gap-2">
            
            <div className="relative w-fit">
              <button 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-700 transition-all flex items-center justify-center"
              >
                {isMobileMenuOpen ? <X className="w-3.5 h-3.5" /> : <MoreVertical className="w-3.5 h-3.5" />}
              </button>

              <AnimatePresence>
                {isMobileMenuOpen && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="fixed inset-0 bg-black/40 z-[-1]"
                    />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, x: "-50%", scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
                      exit={{ opacity: 0, y: 10, x: "-50%", scale: 0.95 }}
                      style={{ left: '50%' }}
                      className="absolute bottom-full mb-4 w-64 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden p-2 flex flex-col gap-1"
                    >
                      <button 
                        onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(false); createManualRestorePoint(); }}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-xl transition-all text-left text-slate-900"
                      >
                        <Save className="w-3.5 h-3.5 text-green-600" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Salva Punto Ripristino</span>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(false); openHistory(); }}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-xl transition-all text-left text-slate-900 border-[3px] border-red-600"
                      >
                        <History className="w-3.5 h-3.5 text-amber-600" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Cronologia Punti</span>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(false); projectInputRef.current?.click(); }}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-xl transition-all text-left text-slate-900"
                      >
                        <Upload className="w-3.5 h-3.5 text-blue-600" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Carica File Progetto</span>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(false); exportProject(); }}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-xl transition-all text-left text-slate-900"
                      >
                        <Download className="w-3.5 h-3.5 text-blue-600" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Salva File Progetto</span>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          <button 
            onMouseDown={(e) => { e.preventDefault(); if(currentStep !== Step.Preview) handleNext(); }} 
            className={`w-12 h-12 flex items-center justify-center bg-emerald-600 text-white rounded-full shadow-lg hover:bg-emerald-500 transition-all active:scale-90 ${currentStep === Step.Preview ? 'invisible' : ''}`}
            title="Prossimo"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </footer>

      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-[10001] animate-in slide-in-from-bottom-4 duration-300 flex items-center gap-3 border ${toast.type === 'success' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-red-600 border-red-500 text-white'}`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span className="text-xs font-black uppercase tracking-widest">{toast.message}</span>
        </div>
      )}

      {/* Hidden inputs for file operations */}
      <input 
        type="file" 
        ref={projectInputRef} 
        className="hidden" 
        accept=".json" 
        onChange={importProject} 
      />
    </div>
  );
};
