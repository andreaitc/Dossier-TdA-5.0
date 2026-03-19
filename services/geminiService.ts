
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { Chapter } from "../types";

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || String(error);
      const isQuotaError = error?.status === 429 || 
                           errorMessage.includes("429") || 
                           errorMessage.includes("RESOURCE_EXHAUSTED") ||
                           errorMessage.includes("quota");
      
      if (isQuotaError && i < maxRetries) {
        const delay = Math.pow(2, i) * 2000 + Math.random() * 1000;
        console.warn(`Gemini API Quota exceeded. Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const CURRICULUM_TDA = `Fondata negli anni Novanta e composta oggi da circa trenta professionisti, la <strong>Compagnia Teatro dell'Argine</strong> sviluppa progetti artistici rivolti all'intera comunità. La sua attività spazia dalla produzione teatrale alla formazione, con un’attenzione particolare al sociale, alla didattica e alla gestione di spazi culturali. Vanta prestigiose collaborazioni con Compagnie, Teatri, Università, Biblioteche, Musei, Carceri, Ospedali, Centri d’accoglienza in Europa, Africa e Sud America. Dal 1998 gestisce alle porte di Bologna l’ITC Teatro, il teatro comunale di San Lazzaro di Savena.

Nel corso degli anni il Teatro dell'Argine è diventato un punto di riferimento in campo nazionale e internazionale non solo sul piano artistico (Premio della Critica 2006, 2015 e 2017, Premio Nico Garrone 2015, Eolo Awards 2018, Premio Rete Critica 2021, Premio Ubu 2011, 2015 e 2021, Max Brauer Preis 2020 dalla Fondazione Toepfer) ma anche nell'ideazione e realizzazione di progetti in cui il teatro si mette a disposizione di contesti interculturali, sociali, educativi e pedagogici. Dal 2008, il Teatro dell’Argine è riconosciuto dal MiC come impresa di produzione e dal 2025 come Centro di Produzione 250 per l’infanzia e la gioventù.

Tra le partnership più importanti segnaliamo aziende come Barilla, Unipol, Hera, Coop Alleanza 3.0; organizzazioni come UNHCR, CISL Emilia-Romagna, CGIL, UIL; fondazioni e associazioni come Fondazione Unipolis, Fondazione Del Monte, Fondazione Marchesini, Fondazione Bartolini, ACRI, Fondazione Fossoli, Associazione tra i Familiari delle Vittime della Strage alla Stazione di Bologna del 2 agosto 1980, ANTEAS, ARCI, ENDAS; enti pubblici come Comune di Bologna, Comune di Bergamo, Comune di San Lazzaro di Savena, Regione Emilia-Romagna, Ministero della Cultura; teatri e istituzioni culturali tra i quali Emilia Romagna Teatro Fondazione, Teatro Comunale di Bologna, Théâtre du Soleil di Parigi, Riksteatern di Stoccolma, Istituzione Bologna Musei – MAMbo, gli Uffizi di Firenze, Mediateca di San Lazzaro di Savena. Infine ha realizzato progetti e performance per Matera Capitale Europea della Cultura 2019 e Brescia Capitale Italiana della Cultura 2023.

Nel 2017, ha ricevuto la <strong>medaglia del Presidente della Repubblica</strong> per il progetto Futuri Maestri.`;

export const analyzeContent = async (text: string): Promise<{ 
  chapters: Chapter[], 
  suggestedTitle: string, 
  suggestedSubtitle: string,
  suggestedImageSubject: string,
  suggestedImageStyle: string
}> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `
    Analizza il testo fornito e organizzalo in un dossier strutturato di esattamente 6 pagine per la Compagnia Teatro dell'Argine.
    
    Inoltre, proponi un TITOLO, un SOTTOTITOLO e un'IMMAGINE per la copertina del dossier basandoti sul contenuto seguendo queste regole:
    - TITOLO: può avere 2, 3, 4 o 5 parole, come ritieni più efficace. Devono essere poetiche, capaci di suggerire, emozionare o divertire.
    - SOTTOTITOLO: può avere 3, 4, 5, 6 o 7 parole, come ritieni più efficace. Devono descrivere il progetto in modo efficace ma non pedante.
    - IMMAGINE (Soggetto): Non deve essere didascalico o letterale, ma deve creare una suggestione poetica legata al tema. 
      Esempio: per un progetto sulla guerra, un giocattolo rotto nel fango è meglio di un esercito.
    - IMMAGINE (Stile e Tecnica): Devono essere suggeriti dal contesto del progetto.
      Esempio: per "fantasia al potere" usa fumetto o fiabesco; per "archivio della memoria" usa disegno tecnico vintage o foto d'epoca.

    DEVI usare rigorosamente queste categorie come titoli dei capitoli, nell'ordine: 
    1. "COSA" (spiegazione del progetto)
    2. "PER CHI" (target di riferimento)
    3. "PERCHÉ" (obiettivi, motivazioni poetiche, artistiche o pedagogiche)
    4. "QUANDO" (tempi di realizzazione)
    5. "QUANTO" (costi e budget)
    6. "CHI SIAMO" (Curriculum aziendale)
    
    Per ogni capitolo:
    1. "title": Solo la parola della categoria (es. "COSA").
    2. "subtitle": Una frase di sintesi potente (può avere 3, 4, 5, 6 o 7 parole).
    3. "keywords": Un array di 4-5 concetti brevi.
    4. "content": Un testo fluido e professionale di circa 150-200 parole basato sul materiale sorgente.
    
    ISTRUZIONE SPECIALE per "CHI SIAMO":
    Ignora il materiale sorgente e usa ESATTAMENTE questo testo per il "content", PRESERVANDO TUTTI I TAG HTML (come <strong>) e i ritorni a capo (\n\n):
    "${CURRICULUM_TDA.replace(/"/g, "'").replace(/\n/g, "\\n")}"
    Per le "keywords" usa ESATTAMENTE queste: ["Arte", "Comunità", "Progetti", "Bellezza"].
    Crea un sottotitolo coerente.

    Restituisci un oggetto JSON con:
    - "suggestedTitle": string
    - "suggestedSubtitle": string
    - "suggestedImageSubject": string (descrizione del soggetto suggestivo)
    - "suggestedImageStyle": string (stile e tecnica suggeriti)
    - "chapters": array di 6 oggetti capitolo.
  `;

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `${prompt}\n\nMateriale sorgente:\n${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedTitle: { type: Type.STRING, description: "Titolo di 2, 3, 4 o 5 parole poetiche e suggestive" },
            suggestedSubtitle: { type: Type.STRING, description: "Sottotitolo di 3, 4, 5, 6 o 7 parole descrittive ma non pedanti" },
            suggestedImageSubject: { type: Type.STRING, description: "Soggetto suggestivo e non didascalico" },
            suggestedImageStyle: { type: Type.STRING, description: "Stile e tecnica coerenti con il tema" },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  subtitle: { type: Type.STRING, description: "Sottotitolo di 3, 4, 5, 6 o 7 parole descrittive" },
                  keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                  content: { type: Type.STRING }
                },
                required: ["title", "subtitle", "keywords", "content"]
              }
            }
          },
          required: ["suggestedTitle", "suggestedSubtitle", "suggestedImageSubject", "suggestedImageStyle", "chapters"]
        }
      }
    }));

    const data = JSON.parse(response.text || "{}");
    const timestamp = Date.now();
    const chapters = (data.chapters || []).map((item: any, index: number) => ({
      ...item,
      id: `ai-ch-${timestamp}-${index}-${Math.random().toString(36).substr(2, 9)}`
    }));

    return {
      chapters,
      suggestedTitle: data.suggestedTitle || "",
      suggestedSubtitle: data.suggestedSubtitle || "",
      suggestedImageSubject: data.suggestedImageSubject || "",
      suggestedImageStyle: data.suggestedImageStyle || ""
    };
  } catch (e) {
    console.error("AI Analyze Error", e);
    return { 
      chapters: [], 
      suggestedTitle: "", 
      suggestedSubtitle: "",
      suggestedImageSubject: "",
      suggestedImageStyle: ""
    };
  }
};

export const generateMetaFromContent = async (content: string): Promise<{ subtitle: string, keywords: string[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `
    Analizza il seguente testo e genera:
    1. Un sottotitolo di sintesi potente (può avere 3, 4, 5, 6 o 7 parole).
    2. Un array di 4-5 parole chiave o concetti brevi.
    
    Restituisci solo un oggetto JSON con i campi "subtitle" e "keywords".
  `;

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `${prompt}\n\nTesto da analizzare:\n${content}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subtitle: { type: Type.STRING, description: "Sottotitolo di 3, 4, 5, 6 o 7 parole descrittive" },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["subtitle", "keywords"]
        }
      }
    }));

    return JSON.parse(response.text || '{"subtitle": "", "keywords": []}');
  } catch (e) {
    console.error("AI Meta Parse Error", e);
    return { subtitle: "", keywords: [] };
  }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `Trascrivi il seguente audio in italiano. Se ci sono più voci, cerca di separarle o comunque di restituire un testo fluido e coerente. Ignora i silenzi e trascrivi fedelmente il contenuto.`;

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Audio,
              mimeType: mimeType
            }
          },
          {
            text: prompt
          }
        ]
      }
    }));
    return response.text || "";
  } catch (e) {
    console.error("AI Audio Transcription Error", e);
    throw e;
  }
};

export const generateCoverImage = async (
  title: string, 
  subject: string, 
  style: string, 
  aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" = "4:3",
  base64Image?: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const systemInstruction = `You are a professional designer. Keep imagination under control: prioritize realism, elegance, and adherence to the user's specific subject. Avoid hallucinations or adding random objects not requested. Ensure the result is clean and suitable for a professional dossier. IMPORTANT: If any text, labels, or annotations appear in the image, they MUST be in Italian.`;
  
  const isTransparent = style.toLowerCase().includes("trasparente") || subject.toLowerCase().includes("trasparente");
  
  const transparencyInstructions = isTransparent ? `
    - MANDATORY: THE SUBJECT MUST BE ON A SOLID, PLAIN WHITE BACKGROUND.
    - ABSOLUTELY NO CHECKERBOARD PATTERNS, NO GREY/WHITE GRIDS.
    - THE SUBJECT MUST BE PERFECTLY ISOLATED AND CLEARLY DEFINED.
  ` : "";

  const editInstructions = base64Image ? `
    - THIS IS AN IMAGE EDITING TASK. 
    - MODIFY THE PROVIDED IMAGE based on the subject and style.
    - If the user asks for a specific addition (e.g., "mettimi un cappello"), add it naturally.
    - Apply the requested style (e.g., "${style}") to the entire image while preserving the original composition as much as possible.
  ` : "";

  const fullPrompt = `Create a professional high-quality artistic image ${isTransparent ? 'isolated on a solid white background' : ''} for a theater company named Teatro dell'Argine.
    ${base64Image ? 'Modify the attached image.' : ''}
    Subject: ${subject || "abstract geometric patterns"}${isTransparent ? ', isolated on white' : ''}. 
    Style Keywords: ${style || "cinematic architectural photography"}. 
    CRITICAL INSTRUCTIONS: 
    ${transparencyInstructions}
    ${editInstructions}
    - NO TEXT, NO LOGOS, NO WATERMARKS.
    - NO BORDERS, NO FRAMES, NO WHITE EDGES.
    - High resolution, professional color palette, clear focus.`;

  const contents: any = { parts: [{ text: fullPrompt }] };
  
  if (base64Image) {
    const base64Data = base64Image.split(',')[1] || base64Image;
    const mimeType = base64Image.split(';')[0].split(':')[1] || 'image/png';
    contents.parts.unshift({
      inlineData: {
        data: base64Data,
        mimeType: mimeType
      }
    });
  }

  try {
    const response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents,
      config: { 
        systemInstruction,
        imageConfig: { 
          aspectRatio
        } 
      }
    }));

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    if (part?.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    throw new Error("Immagine non generata");
  } catch (e) {
    console.error("AI Image Generation Error", e);
    throw e;
  }
};
