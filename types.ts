
export interface Scene {
  timestamp: string; // e.g. "0:05"
  description: string;
  framePrompt: string;
  motionPrompt: string;
  imageUrl?: string;
  videoUrl?: string;
  isGenerating?: boolean;
  isVideoGenerating?: boolean;
  useReference?: boolean;
}

export interface StoryboardState {
  scenes: Scene[];
  isAnalyzing: boolean;
  error?: string;
}