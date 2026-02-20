
import React, { useState, useRef } from 'react';
import JSZip from 'jszip';
import { analyzeAudio, generateSceneImage, generateSceneVideo } from './geminiService';
import { Scene, StoryboardState } from './types';
import Button from './components/Button';
import SceneCard from './components/SceneCard';

const App: React.FC = () => {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [protagonistImage, setProtagonistImage] = useState<{ data: string, mimeType: string, preview: string } | null>(null);
  const [storyInput, setStoryInput] = useState('');
  const [sceneInterval, setSceneInterval] = useState<number>(5);
  const [audioClipLength, setAudioClipLength] = useState<number>(10);
  const [firstClipLength, setFirstClipLength] = useState<number>(10);
  const [videoModel, setVideoModel] = useState<string>('veo-3.1-fast-generate-preview');
  const [state, setState] = useState<StoryboardState>({
    scenes: [],
    isAnalyzing: false,
  });
  const [activeGenerations, setActiveGenerations] = useState(0);
  const [customApiKey, setCustomApiKey] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDownloadingQueue, setIsDownloadingQueue] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const envApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  const resolvedApiKey = customApiKey.trim() || envApiKey;

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0]);
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const data = await fileToBase64(file);
      setProtagonistImage({
        data,
        mimeType: file.type,
        preview: URL.createObjectURL(file)
      });
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      audio.src = url;
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0); // Fallback to 0 if duration can't be read
      };
    });
  };

  const handleCreateStoryboard = async () => {
    if (!audioFile) return;

    setState(prev => ({ ...prev, isAnalyzing: true, error: undefined }));

    try {
      const base64Audio = await fileToBase64(audioFile);
      const duration = await getAudioDuration(audioFile);
      const scenes = await analyzeAudio(
        base64Audio, 
        audioFile.type, 
        storyInput, 
        sceneInterval, 
        duration,
        resolvedApiKey,
        firstClipLength
      );
      setState({
        scenes: scenes.map(s => ({ 
          ...s, 
          isGenerating: false, 
          isVideoGenerating: false,
          // Only use reference if the model recommends it AND we have a reference image
          useReference: (s.useReference !== false) && !!protagonistImage 
        })),
        isAnalyzing: false,
      });
    } catch (err: any) {
      console.error(err);
      setState(prev => ({ 
        ...prev, 
        isAnalyzing: false, 
        error: err.message || "Failed to analyze audio. Please try again." 
      }));
    }
  };

  const handleRegenerateScene = async (index: number) => {
    const sceneToGenerate = state.scenes[index];
    if (sceneToGenerate.isGenerating) return;

    setState(prev => {
      const newScenes = [...prev.scenes];
      newScenes[index] = { ...newScenes[index], isGenerating: true };
      return { ...prev, scenes: newScenes };
    });
    setActiveGenerations(prev => prev + 1);

    try {
      const useReference = sceneToGenerate.useReference && protagonistImage;
      const imageUrl = await generateSceneImage(
        sceneToGenerate.framePrompt, 
        useReference ? { data: protagonistImage.data, mimeType: protagonistImage.mimeType } : undefined,
        resolvedApiKey
      );
      
      setState(prev => {
        const newScenes = [...prev.scenes];
        newScenes[index] = { ...newScenes[index], imageUrl, isGenerating: false };
        return { ...prev, scenes: newScenes };
      });
    } catch (err: any) {
      console.error(err);
      setState(prev => {
        const newScenes = [...prev.scenes];
        newScenes[index] = { ...newScenes[index], isGenerating: false };
        return { ...prev, scenes: newScenes };
      });

    } finally {
      setActiveGenerations(prev => prev - 1);
    }
  };

  const handleRenderVideo = async (index: number) => {
    const sceneToRender = state.scenes[index];
    if (sceneToRender.isVideoGenerating) return;

    setState(prev => {
      const newScenes = [...prev.scenes];
      newScenes[index] = { ...newScenes[index], isVideoGenerating: true };
      return { ...prev, scenes: newScenes };
    });
    setActiveGenerations(prev => prev + 1);

    try {
      const videoUrl = await generateSceneVideo(
        sceneToRender.motionPrompt, 
        sceneToRender.imageUrl,
        videoModel,
        resolvedApiKey
      );
      
      setState(prev => {
        const newScenes = [...prev.scenes];
        newScenes[index] = { ...newScenes[index], videoUrl, isVideoGenerating: false };
        return { ...prev, scenes: newScenes };
      });
    } catch (err: any) {
      console.error(err);
      setState(prev => {
        const newScenes = [...prev.scenes];
        newScenes[index] = { ...newScenes[index], isVideoGenerating: false };
        return { ...prev, scenes: newScenes };
      });

    } finally {
      setActiveGenerations(prev => prev - 1);
    }
  };

  const timestampToSeconds = (ts: string): number => {
    const parts = ts.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] || 0;
  };

  const handleDownloadAudio = async (timestamp: string) => {
    if (!audioFile) return;
    
    const startTime = timestampToSeconds(timestamp);
    const clipDuration = audioClipLength;
    
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const sampleRate = audioBuffer.sampleRate;
      const startOffset = Math.floor(startTime * sampleRate);
      const endOffset = Math.floor(Math.min((startTime + clipDuration) * sampleRate, audioBuffer.length));
      const frameCount = endOffset - startOffset;
      
      if (frameCount <= 0) return;

      const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, frameCount, sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0, startTime, clipDuration);
      
      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(renderedBuffer);
      
      const url = URL.createObjectURL(wavBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `clip-${timestamp.replace(':', '-')}.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error generating audio clip:", err);
    }
  };

  // Helper function to encode AudioBuffer to WAV
  const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let i, sample, offset = 0, pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // write interleaved data
    for (i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < length) {
      for (i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16-bit signed int
        view.setInt16(pos, sample, true); // update data view
        pos += 2;
      }
      offset++;
    }

    return new Blob([bufferArray], { type: "audio/wav" });

    function setUint16(data: number) {
      view.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data: number) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  };

  const downloadFrame = (imageUrl: string, timestamp: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `storyboard-frame-${timestamp.replace(':', '-')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadVideo = (videoUrl: string, timestamp: string) => {
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `storyboard-video-${timestamp.replace(':', '-')}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAllMotionPrompts = () => {
    const content = state.scenes.map(s => s.motionPrompt).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'motion_prompts.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadAllFramePrompts = () => {
    const content = state.scenes.map(s => s.framePrompt).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'image_prompts.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadAllCombinedPrompts = () => {
    const content = state.scenes.map(s => `${s.framePrompt} - ${s.motionPrompt}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'combined_prompts.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadQueue = async () => {
    if (!audioFile || state.scenes.length === 0) return;

    setIsDownloadingQueue(true);

    const zip = new JSZip();
    const queueData: any[] = [];
    
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await audioFile.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        for (let i = 0; i < state.scenes.length; i++) {
            const scene = state.scenes[i];
            const startTime = timestampToSeconds(scene.timestamp);
            const duration = audioClipLength;
            
            const sampleRate = audioBuffer.sampleRate;
            const startOffset = Math.floor(startTime * sampleRate);
            const endOffset = Math.floor(Math.min((startTime + duration) * sampleRate, audioBuffer.length));
            const frameCount = endOffset - startOffset;
            
            // Format indices with 2-digit padding for consistency
            const paddedIndex = (i + 1).toString().padStart(2, '0');
            const audioFilename = `scene_${paddedIndex}.wav`;
            const outputFilename = `scene_${paddedIndex}`;
            
            // Audio processing
            if (frameCount > 0) {
                const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, frameCount, sampleRate);
                const source = offlineCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(offlineCtx.destination);
                source.start(0, startTime, duration);
                
                const renderedBuffer = await offlineCtx.startRendering();
                const wavBlob = audioBufferToWav(renderedBuffer);
                
                zip.file(audioFilename, wavBlob);
            }
            
            // Image processing
            let imageStartFilename: string | null = null;
            let imagePromptType = "";

            if (scene.imageUrl) {
                // scene.imageUrl is "data:image/png;base64,..."
                const parts = scene.imageUrl.split(',');
                if (parts.length === 2) {
                    const base64Data = parts[1];
                    imageStartFilename = `scene_${paddedIndex}_start.png`;
                    zip.file(imageStartFilename, base64Data, {base64: true});
                    imagePromptType = "S";
                }
            }

            // Calculate video_length in frames based on clip length (default 24fps)
            const videoFrames = Math.floor(duration * 24);

            queueData.push({
                "id": i + 1,
                "params": {
                    "image_mode": 0,
                    "prompt": `${scene.framePrompt}. ${scene.motionPrompt}`,
                    "alt_prompt": "",
                    "negative_prompt": "",
                    "resolution": "1920x1088",
                    "video_length": videoFrames,
                    "duration_seconds": 0,
                    "batch_size": 1,
                    "seed": -1,
                    "force_fps": "24",
                    "num_inference_steps": 8,
                    "guidance_scale": 4,
                    "guidance2_scale": 5,
                    "guidance3_scale": 5,
                    "switch_threshold": 0,
                    "switch_threshold2": 0,
                    "guidance_phases": 2,
                    "model_switch_phase": 1,
                    "alt_guidance_scale": 1,
                    "audio_guidance_scale": 4,
                    "audio_scale": 2,
                    "flow_shift": 5,
                    "sample_solver": "",
                    "embedded_guidance_scale": 6,
                    "repeat_generation": 1,
                    "multi_prompts_gen_type": 0,
                    "multi_images_gen_type": 0,
                    "skip_steps_cache_type": "",
                    "skip_steps_multiplier": 1.75,
                    "skip_steps_start_step_perc": 0,
                    "loras_multipliers": "1.0",
                    "image_prompt_type": imagePromptType,
                    "image_start": imageStartFilename,
                    "image_end": null,
                    "model_mode": null,
                    "video_source": null,
                    "keep_frames_video_source": "",
                    "input_video_strength": 1,
                    "video_guide_outpainting": "",
                    "video_prompt_type": "",
                    "image_refs": null,
                    "frames_positions": null,
                    "video_guide": null,
                    "image_guide": null,
                    "keep_frames_video_guide": "",
                    "denoising_strength": 1,
                    "masking_strength": 1,
                    "video_mask": null,
                    "image_mask": null,
                    "control_net_weight": 1,
                    "control_net_weight2": 1,
                    "control_net_weight_alt": 1,
                    "motion_amplitude": 1,
                    "mask_expand": 0,
                    "audio_guide": audioFilename,
                    "audio_guide2": null,
                    "custom_guide": null,
                    "audio_source": null,
                    "audio_prompt_type": "A",
                    "speakers_locations": "0:45 55:100",
                    "sliding_window_size": 501,
                    "sliding_window_overlap": 17,
                    "sliding_window_color_correction_strength": 0,
                    "sliding_window_overlap_noise": 0,
                    "sliding_window_discard_last_frames": 0,
                    "image_refs_relative_size": 50,
                    "remove_background_images_ref": 1,
                    "temporal_upsampling": "",
                    "spatial_upsampling": "",
                    "film_grain_intensity": 0,
                    "film_grain_saturation": 0.5,
                    "MMAudio_setting": 0,
                    "MMAudio_prompt": "",
                    "MMAudio_neg_prompt": "",
                    "RIFLEx_setting": 0,
                    "NAG_scale": 1,
                    "NAG_tau": 3.5,
                    "NAG_alpha": 0.5,
                    "slg_switch": 0,
                    "slg_layers": [
                        29
                    ],
                    "slg_start_perc": 10,
                    "slg_end_perc": 90,
                    "apg_switch": 0,
                    "cfg_star_switch": 0,
                    "cfg_zero_step": -1,
                    "prompt_enhancer": "",
                    "min_frames_if_references": 1,
                    "override_profile": 2,
                    "override_attention": "",
                    "pace": 0.5,
                    "exaggeration": 0.5,
                    "temperature": 0.8,
                    "top_k": 50,
                    "output_filename": outputFilename,
                    "mode": "",
                    "activated_loras": [],
                    "model_type": "ltx2_distilled",
                    "settings_version": 2.45,
                    "base_model_type": "ltx2_19B"
                }
            });
        }
        
        zip.file("queue.json", JSON.stringify(queueData, null, 4));
        
        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = "queue.zip";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
    } catch (e) {
        console.error("Error creating queue zip:", e);
    } finally {
        setIsDownloadingQueue(false);
    }
  };

  const updateMotionPrompt = (index: number, val: string) => {
    setState(prev => {
      const newScenes = [...prev.scenes];
      newScenes[index] = { ...newScenes[index], motionPrompt: val };
      return { ...prev, scenes: newScenes };
    });
  };

  const updateFramePrompt = (index: number, val: string) => {
    setState(prev => {
      const newScenes = [...prev.scenes];
      newScenes[index] = { ...newScenes[index], framePrompt: val };
      return { ...prev, scenes: newScenes };
    });
  };

  const updateUseReference = (index: number, val: boolean) => {
    setState(prev => {
      const newScenes = [...prev.scenes];
      newScenes[index] = { ...newScenes[index], useReference: val };
      return { ...prev, scenes: newScenes };
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8">
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-md w-full shadow-2xl relative">
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Settings
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  API Key Override
                </label>
                <input 
                  type="password" 
                  value={customApiKey} 
                  onChange={e => setCustomApiKey(e.target.value)}
                  placeholder="Enter your Gemini API key..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Leave blank to use the default environment key.
                </p>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <Button onClick={() => setIsSettingsOpen(false)} className="px-6">Done</Button>
            </div>
          </div>
        </div>
      )}

      <header className="max-w-6xl mx-auto mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-white">
              Audio <span className="text-indigo-500">Storyboard</span>
            </h1>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-full transition-all"
              title="Settings"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          <p className="text-slate-400">Transform your audio into visual narratives using Gemini 3.</p>
        </div>
        
        {state.scenes.length > 0 && (
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <Button variant="outline" onClick={downloadAllFramePrompts} className="flex-1 md:flex-none">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Download Image Prompts
            </Button>
            <Button variant="secondary" onClick={downloadAllMotionPrompts} className="flex-1 md:flex-none">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Movement Prompts
            </Button>
            <Button variant="primary" onClick={downloadAllCombinedPrompts} className="flex-1 md:flex-none">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              Download Combined Prompts
            </Button>
            <Button 
                variant="secondary" 
                onClick={handleDownloadQueue} 
                disabled={isDownloadingQueue}
                className={`flex-1 md:flex-none bg-purple-600 hover:bg-purple-700 shadow-purple-500/20 text-white border-none relative overflow-hidden transition-all duration-200 ${isDownloadingQueue ? 'cursor-not-allowed opacity-90' : ''}`}
            >
                {isDownloadingQueue && (
                    <div 
                        className="absolute inset-0 z-0 animate-stripes opacity-20 pointer-events-none"
                        style={{
                            backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.3) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.3) 75%, transparent 75%, transparent)',
                            backgroundSize: '40px 40px'
                        }}
                    />
                )}
                <span className="relative z-10 flex items-center gap-2">
                    {isDownloadingQueue ? (
                        <>
                             <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Creating Zip...
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                            Download Wan2GP Queue
                        </>
                    )}
                </span>
            </Button>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto">
        {state.scenes.length === 0 ? (
          <div className="max-w-3xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">1. Upload Audio (MP3)</label>
                  <div 
                    onClick={() => audioInputRef.current?.click()}
                    className={`h-48 border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all ${audioFile ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'}`}
                  >
                    <input type="file" accept="audio/mpeg" className="hidden" ref={audioInputRef} onChange={handleAudioChange} />
                    {audioFile ? (
                      <div className="text-center overflow-hidden w-full">
                        <svg className="w-10 h-10 text-indigo-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        <p className="font-semibold text-white truncate text-sm px-2">{audioFile.name}</p>
                      </div>
                    ) : (
                      <>
                        <svg className="w-10 h-10 text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-xs text-slate-400 text-center">Click to upload MP3</p>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">2. Protagonist Reference (Optional)</label>
                  <div 
                    onClick={() => imageInputRef.current?.click()}
                    className={`h-48 border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all ${protagonistImage ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'}`}
                  >
                    <input type="file" accept="image/*" className="hidden" ref={imageInputRef} onChange={handleImageChange} />
                    {protagonistImage ? (
                      <div className="relative w-full h-full">
                        <img src={protagonistImage.preview} className="w-full h-full object-contain rounded-lg" alt="Protagonist" />
                        <button 
                          onClick={(e) => { e.stopPropagation(); setProtagonistImage(null); }}
                          className="absolute -top-2 -right-2 bg-rose-600 text-white p-1 rounded-full hover:bg-rose-700"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ) : (
                      <>
                        <svg className="w-10 h-10 text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-xs text-slate-400 text-center">Reference for character consistency</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                <div className="md:col-span-4">
                  <label className="block text-sm font-medium text-slate-300 mb-2">3. Story Concept (Optional)</label>
                  <textarea
                    value={storyInput}
                    onChange={(e) => setStoryInput(e.target.value)}
                    placeholder="Describe your story idea... If left blank, Gemini will craft one."
                    className="w-full h-24 bg-slate-800 border border-slate-700 rounded-xl p-4 text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none text-sm"
                  />
                </div>
                <div className="md:col-span-4 grid grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Scene Interval (s)</label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      max="60"
                      value={sceneInterval}
                      onChange={(e) => setSceneInterval(parseFloat(e.target.value) || 5)}
                      className="w-full h-12 bg-slate-800 border border-slate-700 rounded-xl px-4 text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">First Clip Length (s)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      max="60"
                      value={firstClipLength}
                      onChange={(e) => setFirstClipLength(parseFloat(e.target.value) || 10)}
                      className="w-full h-12 bg-slate-800 border border-slate-700 rounded-xl px-4 text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Download Clip Length (s)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      max="60"
                      value={audioClipLength}
                      onChange={(e) => setAudioClipLength(parseFloat(e.target.value) || 10)}
                      className="w-full h-12 bg-slate-800 border border-slate-700 rounded-xl px-4 text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                    />
                  </div>
                </div>
              </div>

              <Button 
                variant="primary" 
                className="w-full py-4 text-lg" 
                disabled={!audioFile || state.isAnalyzing}
                isLoading={state.isAnalyzing}
                onClick={handleCreateStoryboard}
              >
                Create Storyboard
              </Button>

              {state.error && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg text-rose-500 text-sm">
                  {state.error}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                Generated Scenes
                <span className="text-sm font-normal text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                  {state.scenes.length} Scenes
                </span>
                {protagonistImage && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                    Character Consistency Active
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                   <span className="text-xs text-slate-500 font-medium hidden md:inline">Video Model:</span>
                   <select
                      value={videoModel}
                      onChange={(e) => setVideoModel(e.target.value)}
                      className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2 outline-none"
                   >
                      <option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast (Preview)</option>
                      <option value="veo-3.1-generate-preview">Veo 3.1 (Preview)</option>
                      <option value="veo-3.1-fast-generate-001">Veo 3.1 Fast (001)</option>
                      <option value="veo-3.1-generate-001">Veo 3.1 (001)</option>
                   </select>
                </div>

                {activeGenerations > 0 && (
                   <span className="text-xs text-indigo-400 animate-pulse whitespace-nowrap">
                     Active tasks: {activeGenerations}
                   </span>
                )}
                <Button variant="outline" onClick={() => setState({ scenes: [], isAnalyzing: false })} className="text-xs">
                  Start Over
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {state.scenes.map((scene, idx) => (
                <SceneCard
                  key={idx}
                  scene={scene}
                  hasGlobalReference={!!protagonistImage}
                  onRegenerate={() => handleRegenerateScene(idx)}
                  onDownload={() => scene.imageUrl && downloadFrame(scene.imageUrl, scene.timestamp)}
                  onRenderVideo={() => handleRenderVideo(idx)}
                  onDownloadVideo={() => scene.videoUrl && downloadVideo(scene.videoUrl, scene.timestamp)}
                  onDownloadAudio={() => handleDownloadAudio(scene.timestamp)}
                  onMotionPromptChange={(val) => updateMotionPrompt(idx, val)}
                  onFramePromptChange={(val) => updateFramePrompt(idx, val)}
                  onUseReferenceChange={(val) => updateUseReference(idx, val)}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-6xl mx-auto mt-20 pt-8 border-t border-slate-800 text-center text-slate-600 text-sm">
        <p>Built with Gemini 3 Flash, Nano Banana Pro & Veo 3.1</p>
        <div className="flex justify-center gap-4 mt-2">
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="hover:text-slate-400">
            Billing Documentation
          </a>
        </div>
      </footer>
    </div>
  );
};

export default App;
