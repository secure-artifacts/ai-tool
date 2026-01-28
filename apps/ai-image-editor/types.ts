export type Tool = 'brush' | 'rectangle' | 'move' | 'crop';

export interface Layer {
  id: string;
  name: string;
  imageUrl: string; // dataURL
  file: File;
  opacity: number; // 0-1
  isVisible: boolean;
  sourceLayerId?: string; // ID of the layer this was generated from
  x: number;
  y: number;
  scale: number;
}

export interface MagicPrompt {
    id: string;
    nameKey: string;
    prompt: string;
}

export interface MagicGroup {
    id: string;
    nameKey: string;
    prompts: MagicPrompt[];
}