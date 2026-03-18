import { GoogleGenAI, Type } from "@google/genai";
import { buildStoryboardTimeline } from "./audioAnalysis";
import { AudioAnalysisSummary, Scene, StoryboardProvider } from "./types";

type ReferenceImageInput = {
  data: string;
  mimeType: string;
};

type AnalyzeAudioOptions = {
  storyInput?: string;
  interval?: number;
  duration?: number;
  apiKey?: string;
  firstClipLength?: number;
  referenceImages?: ReferenceImageInput[];
  provider?: StoryboardProvider;
  ollamaUrl?: string;
  ollamaModel?: string;
  audioSummary?: AudioAnalysisSummary;
};

type TimelineEntry = ReturnType<typeof buildStoryboardTimeline>[number];

const GEMINI_STORYBOARD_MODEL = 'gemini-3-flash-preview';
const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
export const DEFAULT_STORYBOARD_PROVIDER: StoryboardProvider =
  process.env.STORYBOARD_PROVIDER === 'ollama' ? 'ollama' : 'gemini';

const normalizeReferenceNumbers = (referenceNumbers: unknown, maxReferenceNumber: number): number[] => {
  if (!Array.isArray(referenceNumbers) || maxReferenceNumber < 1) return [];

  return Array.from(
    new Set(
      referenceNumbers
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxReferenceNumber)
    )
  ).sort((a, b) => a - b);
};

const resolveGeminiApiKey = (apiKey?: string): string => {
  const finalApiKey = apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!finalApiKey) {
    throw new Error("Gemini API Key is missing. Please provide it in settings or ensure the environment is configured.");
  }
  return finalApiKey;
};

const normalizeOllamaBaseUrl = (baseUrl?: string): string => {
  const resolved = (baseUrl || DEFAULT_OLLAMA_BASE_URL).trim();
  return resolved.replace(/\/+$/, '');
};

const extractJsonArray = (rawText: string): unknown[] => {
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall back to extracting the first JSON array block below.
  }

  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const candidate = cleaned.slice(firstBracket, lastBracket + 1);
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  }

  throw new Error("Invalid JSON response format from AI.");
};

const normalizeScenes = (
  scenes: unknown[],
  maxReferenceNumber: number,
  timeline: TimelineEntry[]
): Scene[] => {
  return timeline.map((timelineEntry, index) => {
    const scene = (scenes[index] as Partial<Scene> | undefined) || {};
    const fallbackDescription = `Visual beat at ${timelineEntry.timestamp}, shaped by the music in this segment.`;
    const fallbackFramePrompt = `Cinematic still frame, 16:9 composition, a visually striking interpretation of the music at ${timelineEntry.timestamp}, rich detail, dramatic lighting, consistent filmic grade.`;
    const fallbackMotionPrompt = `Cinematic motion synchronized to the music at ${timelineEntry.timestamp}. Motion: camera drift, rhythmic subject movement, and environment details reacting precisely to the beat. Sync: strong lip-sync or audio-reactive timing where applicable. Atmosphere: preserve the same cinematic style and emotional tone as the frame prompt.`;

    return {
      timestamp: typeof scene.timestamp === 'string' && scene.timestamp.trim() ? scene.timestamp.trim() : timelineEntry.timestamp,
      description: typeof scene.description === 'string' && scene.description.trim() ? scene.description.trim() : fallbackDescription,
      framePrompt: typeof scene.framePrompt === 'string' && scene.framePrompt.trim() ? scene.framePrompt.trim() : fallbackFramePrompt,
      motionPrompt: typeof scene.motionPrompt === 'string' && scene.motionPrompt.trim() ? scene.motionPrompt.trim() : fallbackMotionPrompt,
      referenceImageNumbers: normalizeReferenceNumbers(scene.referenceImageNumbers, maxReferenceNumber)
    };
  });
};

const analyzeAudioWithGemini = async (
  base64Audio: string,
  mimeType: string,
  {
    storyInput,
    interval = 5,
    duration,
    apiKey,
    firstClipLength = 10,
    referenceImages = []
  }: AnalyzeAudioOptions
): Promise<Scene[]> => {
  const ai = new GoogleGenAI({ apiKey: resolveGeminiApiKey(apiKey) });

  const formatDurationAsMmSs = (seconds: number): string => {
    const totalSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };
  
  const durationInfo = typeof duration === "number"
    ? `The total duration of this audio is exactly ${formatDurationAsMmSs(duration)} (mm:ss), don't stop before you've analyzed the entire length of the audio.`
    : "";

  const safeReferenceImages = referenceImages
    .filter((image) => !!image?.data && !!image?.mimeType)
    .slice(0, 5);
  const safeReferenceImageCount = safeReferenceImages.length;
  const hasReferenceImages = safeReferenceImageCount > 0;
  const referenceInstruction = hasReferenceImages
    ? `You have exactly ${safeReferenceImageCount} reference image(s) available for this request, indexed 1 through ${safeReferenceImageCount}, in the same order as provided in the input.`
    : "There are no reference images available for this request.";

  const systemInstruction = `
    You are an expert storyboard artist and video director specialized in LTX2 generation.
    Analyze the provided audio. ${durationInfo}
    If a story description is provided, follow it. 
    If not, create a coherent, emotionally resonant story that fits the music's mood and structure.
    ${referenceInstruction}
    
    TIMING STRUCTURE RULES (STRICT):
    1. The FIRST scene MUST start at timestamp "0:00".
    2. The SECOND scene MUST start exactly ${firstClipLength} seconds after the first (e.g., "0:${firstClipLength < 10 ? '0' + firstClipLength : firstClipLength}").
    3. All SUBSEQUENT scenes MUST occur every ${interval} seconds after the second scene.
    4. Provide scene information across the ENTIRE audio duration based on this cadence.
    
    CRITICAL PROMPT GENERATION RULES:
    1. ISOLATION: Every 'framePrompt' is generated in isolation. Do NOT use connecting words like "now", "then", "next", or "continues". Each prompt must fully describe the subject and scene context independently. Always describe characters in full detail, don't reference to them as "the protagonist" or "the dancers".
    2. FIRST FRAME: The 'framePrompt' represents the *first frame* of a video clip. Do NOT describe actions of things *entering* the frame. Describe the scene state at the very beginning of the shot.
    3. VISUAL STYLE: Define a consistent visual style (e.g., "Cinematic lighting, 4k, gloomy atmosphere, oil painting style") and REPEAT this exact style description in EVERY 'framePrompt'.
    4. IMAGE REFERENCE SELECTION: For each scene, decide which reference images should be visible in the first frame. Output this in 'referenceImageNumbers' as an array of 1-based indices.
       - If no references should be used, output an empty array [].
       - If no references are available, ALWAYS output [].
       - Only use integers within the valid range of available references.
    5. MULTIPLE IMAGE REFERENCES: When using multiple image references in the same framePrompt, the framePrompt should make it clear which character is from which reference image by going (image 1) or (image 2) after the character description.

    LTX2 MOTION PROMPT GUIDELINES (AUDIO-REACTIVE FOCUS):
    The 'motionPrompt' MUST be tuned for LTX2, instructed to maximize audio-reactivity and lip syncing.
    Use the following examples as the expected style and structure for your motion prompts:

    Example 1: The High-Fidelity Lip-Sync (Close-Up) - Use for dialogue or vocals.
    "Extreme close-up, 8k resolution, of a neo-soul singer. Motion: Her lips move with perfect phonetic precision, articulating every syllable with visible tension in the jaw and throat muscles. Sync: The movement is crisp and rhythmic, following a melodic cadence. Atmosphere: Soft purple rim lighting catches the moisture on her lips; subtle micro-expressions in the eyes match the emotional weight of the speech."

    Example 2: The "Shaking to the Beat" (Physical Reaction) - Use for heavy beats/bass.
    "A wide shot of a gritty, industrial warehouse rave. Physics: The entire frame shudders and vibrates in sync with a heavy techno beat. Motion: Dust particles in the air 'jump' rhythmically with every bass drop. Visuals: Large hanging industrial lamps swing in a 128-BPM cadence. Strobe lights flicker in perfect intervals, momentarily freezing the motion of the crowd in high-contrast silhouettes."

    Example 3: The "Audio-Reactive" Macro Shot - Use for abstract or instrumental sections.
    "Macro shot of a dark liquid puddle on a subwoofer. Motion: The liquid forms complex cymatic patterns that pulse and peak to a rhythmic beat. Physics: With every 'kick drum' impact, the liquid spikes upward in a sharp, vertical jolt, then settles into concentric ripples. Lighting: Neon cyan reflections stretch and distort across the surface of the water in time with the vibrations."

    For each scene, provide:
    1. A 'timestamp' (e.g., "0:05", "0:10").
    2. A 'description': A narrative description of what happens.
    3. A 'framePrompt': A highly detailed visual prompt for a high-quality cinematic still (16:9), following the rules above.
    4. A 'motionPrompt': A specific LTX2-style prompt describing movement, physics, and sync, adopting the structure of the examples above.
    5. A 'referenceImageNumbers': Array<number> containing the 1-based indices of the reference images to use for the first frame.
  `;

  const prompt = storyInput 
    ? `Create a storyboard for this audio, based on this story: "${storyInput}"`
    : "Create a coherent story and storyboard based on the mood and rhythm of this audio.";

  const analysisParts: any[] = [];
  safeReferenceImages.forEach((image, idx) => {
    analysisParts.push({ text: `Reference image ${idx + 1}` });
    analysisParts.push({
      inlineData: {
        data: image.data,
        mimeType: image.mimeType
      }
    });
  });
  analysisParts.push({ inlineData: { data: base64Audio, mimeType } });
  analysisParts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: GEMINI_STORYBOARD_MODEL,
    contents: {
      parts: analysisParts
    },
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            timestamp: { type: Type.STRING },
            description: { type: Type.STRING },
            framePrompt: { type: Type.STRING },
            motionPrompt: { type: Type.STRING },
            referenceImageNumbers: {
              type: Type.ARRAY,
              items: { type: Type.NUMBER }
            },
          },
          required: ["timestamp", "description", "framePrompt", "motionPrompt", "referenceImageNumbers"],
        },
      },
    },
  });

  try {
    const scenes = extractJsonArray(response.text || "");
    const timeline = buildStoryboardTimeline(duration || 0, firstClipLength, interval);
    const normalized = normalizeScenes(
      scenes,
      safeReferenceImageCount,
      timeline.length > 0 ? timeline : [{ timestamp: "0:00", startSeconds: 0, endSeconds: duration || 0 }]
    );

    if (normalized.length > 0) {
      return normalized;
    }
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
  }

  throw new Error("Invalid response format from AI.");
};

const buildOllamaPrompt = (
  audioSummary: AudioAnalysisSummary,
  timeline: TimelineEntry[],
  storyInput: string | undefined,
  referenceCount: number
): string => {
  const timelineSummary = timeline.map((entry, index) => {
    const segment = audioSummary.segments[index];
    return {
      timestamp: entry.timestamp,
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      energy: segment?.energy || 'medium',
      trend: segment?.trend || 'steady',
      averageIntensity: segment?.averageIntensity ?? 0,
      peakIntensity: segment?.peakIntensity ?? 0
    };
  });

  return [
    `Create one storyboard scene for each timestamp in this exact schedule and return a raw JSON array only.`,
    `If a story concept is provided, follow it. If not, invent a coherent story that matches the musical energy and pacing.`,
    `Uploaded reference images are not sent to the local model. ${referenceCount > 0 ? `There are ${referenceCount} uploaded reference image slots available, but unless the story explicitly requires a slot number, leave referenceImageNumbers as [].` : `There are no reference images available, so always output [].`}`,
    `Use a single consistent visual style phrase and repeat that exact style phrase in every framePrompt.`,
    `Every framePrompt must stand alone and describe the first frame of the shot, never a transition from a previous shot.`,
    `Every motionPrompt must be optimized for LTX2 and emphasize beat sync, audio reactivity, physics, and lip sync when appropriate.`,
    `Required JSON shape for every item: {"timestamp":"0:00","description":"...","framePrompt":"...","motionPrompt":"...","referenceImageNumbers":[]}`,
    `Global audio summary: ${JSON.stringify({
      durationSeconds: audioSummary.durationSeconds,
      overallEnergy: audioSummary.overallEnergy,
      dynamicRange: audioSummary.dynamicRange,
      estimatedBpm: audioSummary.estimatedBpm,
      notableMoments: audioSummary.notableMoments
    })}`,
    `Scene timing and musical cues: ${JSON.stringify(timelineSummary)}`,
    storyInput?.trim()
      ? `Story concept: ${storyInput.trim()}`
      : `No story concept was supplied. Invent one that tracks the musical arc.`,
    `Return only JSON. No markdown, no prose, no explanation.`
  ].join('\n\n');
};

const analyzeAudioWithOllama = async ({
  storyInput,
  interval = 5,
  duration,
  firstClipLength = 10,
  referenceImages = [],
  ollamaUrl,
  ollamaModel,
  audioSummary
}: AnalyzeAudioOptions): Promise<Scene[]> => {
  if (!audioSummary) {
    throw new Error("Local Ollama storyboard generation requires browser audio analysis data.");
  }

  const safeDuration = duration || audioSummary.durationSeconds;
  const timeline = buildStoryboardTimeline(safeDuration, firstClipLength, interval);
  const prompt = buildOllamaPrompt(audioSummary, timeline, storyInput, referenceImages.length);
  const baseUrl = normalizeOllamaBaseUrl(ollamaUrl);
  const model = (ollamaModel || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.4
        }
      })
    });
  } catch (error) {
    throw new Error(`Could not reach Ollama at ${baseUrl}. Check that the server is running and accessible from the browser.`);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = typeof result?.error === 'string' ? result.error : `${response.status} ${response.statusText}`;
    throw new Error(`Ollama request failed: ${errorMessage}`);
  }
  if (typeof result?.error === 'string' && result.error.trim()) {
    throw new Error(`Ollama error: ${result.error}`);
  }

  const rawText = typeof result?.response === 'string' ? result.response : '';
  const scenes = extractJsonArray(rawText);
  return normalizeScenes(scenes, referenceImages.length, timeline);
};

export const analyzeAudio = async (
  base64Audio: string,
  mimeType: string,
  options: AnalyzeAudioOptions = {}
): Promise<Scene[]> => {
  const provider: StoryboardProvider = options.provider === 'ollama' || options.provider === 'gemini'
    ? options.provider
    : DEFAULT_STORYBOARD_PROVIDER;
  if (provider === 'ollama') {
    return analyzeAudioWithOllama(options);
  }

  return analyzeAudioWithGemini(base64Audio, mimeType, options);
};

export const generateSceneImage = async (
  prompt: string, 
  referenceImages?: Array<{ data: string, mimeType: string }>,
  model: string = 'gemini-3-flash-preview',
  apiKey?: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: resolveGeminiApiKey(apiKey) });
  
  const parts: any[] = [];

  if (referenceImages && referenceImages.length > 0) {
    for (const referenceImage of referenceImages) {
      parts.push({
        inlineData: {
          data: referenceImage.data,
          mimeType: referenceImage.mimeType
        }
      });
    }
    parts.push({
      text: `Use all provided reference images as visual guidance for the subject(s), object(s), and style in this scene while keeping consistency. Scene prompt: ${prompt}`
    });
  } else {
    parts.push({ text: prompt });
  }

  const response = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "1K"
      }
    },
  });

  const candidateParts = (response.candidates || []).flatMap((candidate: any) =>
    Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
  );

  for (const part of candidateParts) {
    if (part?.inlineData?.data) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  const finishReasons = (response.candidates || [])
    .map((candidate: any) => candidate?.finishReason)
    .filter(Boolean)
    .join(", ");
  const modelText = typeof response.text === "string" ? response.text.trim() : "";

  throw new Error(
    `No image was generated.${finishReasons ? ` Finish reason: ${finishReasons}.` : ""}${modelText ? ` Model output: ${modelText.slice(0, 180)}` : ""}`
  );
};

export const generateSceneVideo = async (
  prompt: string,
  imageUri?: string,
  model: string = 'veo-3.1-fast-generate-preview',
  apiKey?: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: resolveGeminiApiKey(apiKey) });
  
  const imagePart = imageUri ? {
    imageBytes: imageUri.split(',')[1],
    mimeType: imageUri.split(';')[0].split(':')[1]
  } : undefined;

  const finalPrompt = prompt?.trim() || "Cinematic cinematic motion";

  const config: any = {
    numberOfVideos: 1,
    resolution: '720p',
    aspectRatio: '16:9'
  };

  const videoParams: any = {
    model: model,
    prompt: finalPrompt,
    config
  };

  if (imagePart) {
    videoParams.image = imagePart;
  }

  let operation = await ai.models.generateVideos(videoParams);

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    throw new Error("Video generation failed or link not found.");
  }

  const response = await fetch(`${downloadLink}&key=${resolveGeminiApiKey(apiKey)}`);
  if (!response.ok) {
    throw new Error(`Failed to download generated video: ${response.status} ${response.statusText}`);
  }
  
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};
