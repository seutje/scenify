
import React from 'react';
import { Scene } from '../types';
import Button from './Button';

interface SceneCardProps {
  scene: Scene;
  hasGlobalReference: boolean;
  onRegenerate: () => void;
  onDownload: () => void;
  onRenderVideo: () => void;
  onDownloadVideo: () => void;
  onDownloadAudio: () => void;
  onMotionPromptChange: (val: string) => void;
  onFramePromptChange: (val: string) => void;
  onUseReferenceChange: (val: boolean) => void;
}

const SceneCard: React.FC<SceneCardProps> = ({ 
  scene, 
  hasGlobalReference,
  onRegenerate, 
  onDownload,
  onRenderVideo,
  onDownloadVideo,
  onDownloadAudio,
  onMotionPromptChange,
  onFramePromptChange,
  onUseReferenceChange
}) => {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden flex flex-col group hover:border-indigo-500/50 transition-colors">
      <div className="relative aspect-video bg-slate-900 flex items-center justify-center overflow-hidden">
        {scene.videoUrl ? (
          <video 
            src={scene.videoUrl} 
            className="w-full h-full object-cover" 
            controls 
            loop 
            muted 
          />
        ) : scene.imageUrl ? (
          <img 
            src={scene.imageUrl} 
            alt={scene.description} 
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center text-slate-500 p-4 text-center">
            {scene.isGenerating || scene.isVideoGenerating ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm font-medium animate-pulse">
                  {scene.isVideoGenerating ? 'Rendering video...' : 'Generating frame...'}
                </span>
              </div>
            ) : (
              <>
                <svg className="w-12 h-12 mb-2 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs">No media generated yet</span>
              </>
            )}
          </div>
        )}
        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-xs font-bold text-indigo-400 border border-indigo-500/30">
          {scene.timestamp}
        </div>
        {scene.isVideoGenerating && !scene.videoUrl && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Rendering Veo</span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col flex-grow">
        <h4 className="text-sm font-semibold text-slate-200 mb-2 line-clamp-2">
          {scene.description}
        </h4>
        
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              Frame Prompt (Image Generation)
            </label>
            {hasGlobalReference && (
              <label className="flex items-center gap-1.5 cursor-pointer group/ref">
                <input 
                  type="checkbox"
                  checked={scene.useReference}
                  onChange={(e) => onUseReferenceChange(e.target.checked)}
                  className="w-3 h-3 rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-indigo-500 transition-colors"
                />
                <span className="text-[10px] text-slate-400 font-medium group-hover/ref:text-slate-300 transition-colors">Use Reference</span>
              </label>
            )}
          </div>
          <textarea
            value={scene.framePrompt}
            onChange={(e) => onFramePromptChange(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 resize-none h-16"
          />
        </div>

        <div className="mb-4">
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
            Motion Prompt (LTX2 Audio-Reactive)
          </label>
          <textarea
            value={scene.motionPrompt}
            onChange={(e) => onMotionPromptChange(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 resize-none h-16"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button 
              variant="primary" 
              className="flex-1 text-xs py-1.5" 
              onClick={onRegenerate}
              isLoading={scene.isGenerating}
              disabled={scene.isVideoGenerating}
            >
              Regenerate Frame
            </Button>
            <Button 
              variant="outline" 
              className="px-2 py-1.5"
              onClick={onDownload}
              disabled={!scene.imageUrl}
              title="Download Frame"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <Button 
                variant="secondary" 
                className="flex-1 text-xs py-1.5" 
                onClick={onRenderVideo}
                isLoading={scene.isVideoGenerating}
                disabled={scene.isGenerating}
              >
                Render Video
              </Button>
              <Button 
                variant="outline" 
                className="px-2 py-1.5 border-indigo-700 text-indigo-500 hover:border-indigo-500 hover:text-indigo-400"
                onClick={onDownloadAudio}
                title="Download 10s Clip"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </Button>
              <Button 
                variant="outline" 
                className="px-2 py-1.5 border-emerald-700 text-emerald-500 hover:border-emerald-500 hover:text-emerald-400"
                onClick={onDownloadVideo}
                disabled={!scene.videoUrl}
                title="Download Video"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l-3 3m0 0l-3-3m3 3V4M5 20h14a2 2 0 002-2v-5M17 16l-2 2H9l-2-2" />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SceneCard;
