export interface Chapter {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  content: string;
  titleFontSize?: number;
  subtitleFontSize?: number;
  image?: string | null;
  imageZoom?: number;
  imagePosition?: { x: number; y: number };
  isConfirmingDelete?: boolean;
}

export interface DocumentStyle {
  sidebarBg: string;
  mainBg: string;
  sidebarText: string;
  mainText: string;
  accentColor: string;
}

export type LayoutType = 'print' | 'computer';

export interface Contact {
  name: string;
  email: string;
  phone: string;
  role?: string;
}

export interface Palette {
  name: string;
  style: DocumentStyle;
}

export interface AppState {
  title: string;
  titleFontSize: number;
  subtitle: string;
  subtitleFontSize: number;
  authors: string;
  authorsFontSize: number;
  coverSubject: string;
  coverStyle: string;
  coverImage: string | null;
  isCoverImageAiGenerated: boolean;
  coverZoom: number;
  coverPosition: { x: number; y: number };
  style: DocumentStyle;
  chapters: Chapter[];
  layoutType: LayoutType;
  contacts: Contact[];
  contactsFontSizeOffset?: number;
  currentStep?: Step;
  inputText?: string;
  uploadedFileNames?: string[];
  favorites?: string[];
  palettes?: Palette[];
}

export enum Step {
  Selection = 'selection',
  Content = 'content',
  Setup = 'setup',
  Style = 'style',
  Editor = 'editor',
  Preview = 'preview',
  PrintPreview = 'printPreview'
}