
export interface Scene {
  timestamp: string; // e.g. "0:05"
  description: string;
  framePrompt: string;
  motionPrompt: string;
  imageUrl?: string;
  videoUrl?: string;
  isGenerating?: boolean;
  isVideoGenerating?: boolean;
  referenceImageNumbers?: number[];
}

export interface StoryboardState {
  scenes: Scene[];
  isAnalyzing: boolean;
  error?: string;
}

export type StoryboardProvider = 'ollama' | 'gemini';

export type AudioEnergyLevel = 'low' | 'medium' | 'high';
export type AudioTrend = 'falling' | 'steady' | 'rising';

export interface AudioAnalysisSegment {
  timestamp: string;
  startSeconds: number;
  endSeconds: number;
  averageIntensity: number;
  peakIntensity: number;
  energy: AudioEnergyLevel;
  trend: AudioTrend;
}

export interface AudioAnalysisSummary {
  durationSeconds: number;
  overallEnergy: AudioEnergyLevel;
  dynamicRange: AudioEnergyLevel;
  estimatedBpm?: number;
  segments: AudioAnalysisSegment[];
  notableMoments: string[];
}
