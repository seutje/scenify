
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { Scene } from "./types";

export const analyzeAudio = async (
  base64Audio: string,
  mimeType: string,
  storyInput?: string,
  interval: number = 5,
  duration?: number,
  apiKey?: string,
  firstClipLength: number = 10
): Promise<Scene[]> => {
  const finalApiKey = apiKey || process.env.API_KEY;
  if (!finalApiKey) {
    throw new Error("API Key is missing. Please provide it in settings or ensure the environment is configured.");
  }
  const ai = new GoogleGenAI({ apiKey: finalApiKey });
  
  const durationInfo = duration 
    ? `The total duration of this audio is exactly ${duration.toFixed(2)} seconds.` 
    : "";

  const systemInstruction = `
    You are an expert storyboard artist and video director specialized in LTX2 generation.
    Analyze the provided audio. ${durationInfo}
    If a story description is provided, follow it. 
    If not, create a coherent, emotionally resonant story that fits the music's mood and structure.
    
    TIMING STRUCTURE RULES (STRICT):
    1. The FIRST scene MUST start at timestamp "0:00".
    2. The SECOND scene MUST start exactly ${firstClipLength} seconds after the first (e.g., "0:${firstClipLength < 10 ? '0' + firstClipLength : firstClipLength}").
    3. All SUBSEQUENT scenes MUST occur every ${interval} seconds after the second scene.
    4. Provide scene information across the ENTIRE audio duration based on this cadence.
    
    CRITICAL PROMPT GENERATION RULES:
    1. ISOLATION: Every 'framePrompt' is generated in isolation. Do NOT use connecting words like "now", "then", "next", or "continues". Each prompt must fully describe the subject and scene context independently.
    2. FIRST FRAME: The 'framePrompt' represents the *first frame* of a video clip. Do NOT describe actions of things *entering* the frame. Describe the scene state at the very beginning of the shot.
    3. VISUAL STYLE: Define a consistent visual style (e.g., "Cinematic lighting, 4k, gloomy atmosphere, oil painting style") and REPEAT this exact style description in EVERY 'framePrompt'.
    4. IMAGE REFERENCE TOGGLE: For each scene, decide if the person, people or object in the reference image should be visible in the first frame. Set 'useReference' to true if they are visible, and false if they are not.

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
    5. A 'useReference': Boolean indicating if the reference image should be used to generate the first frame.
  `;

  const prompt = storyInput 
    ? `Based on this story: "${storyInput}", create a storyboard for this audio.`
    : "Create a coherent story and storyboard based on the mood and rhythm of this audio.";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { data: base64Audio, mimeType } },
        { text: prompt }
      ]
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
            useReference: { type: Type.BOOLEAN },
          },
          required: ["timestamp", "description", "framePrompt", "motionPrompt", "useReference"],
        },
      },
    },
  });

  try {
    const scenes: Scene[] = JSON.parse(response.text || "[]");
    return scenes;
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    throw new Error("Invalid response format from AI.");
  }
};

export const generateSceneImage = async (
  prompt: string, 
  referenceImage?: { data: string, mimeType: string },
  apiKey?: string
): Promise<string> => {
  const finalApiKey = apiKey || process.env.API_KEY;
  if (!finalApiKey) {
    throw new Error("API Key is missing.");
  }
  const ai = new GoogleGenAI({ apiKey: finalApiKey });
  
  const parts: any[] = [];
  
  if (referenceImage) {
    parts.push({
      inlineData: {
        data: referenceImage.data,
        mimeType: referenceImage.mimeType
      }
    });
    parts.push({
      text: `Use the character from the provided reference image as the main protagonist in this scene, maintaining their appearance, features, and clothing for consistency. Scene prompt: ${prompt}`
    });
  } else {
    parts.push({ text: prompt });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: { parts },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "1K"
      }
    },
  });

  let imageUrl = '';
  const candidates = response.candidates;
  if (candidates && candidates.length > 0) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData) {
        imageUrl = `data:image/png;base64,${part.inlineData.data}`;
        break;
      }
    }
  }

  if (!imageUrl) {
    throw new Error("No image was generated.");
  }

  return imageUrl;
};

export const generateSceneVideo = async (
  prompt: string,
  imageUri?: string,
  model: string = 'veo-3.1-fast-generate-preview',
  apiKey?: string
): Promise<string> => {
  const finalApiKey = apiKey || process.env.API_KEY;
  if (!finalApiKey) {
    throw new Error("API Key is missing.");
  }
  const ai = new GoogleGenAI({ apiKey: finalApiKey });
  
  const imagePart = imageUri ? {
    imageBytes: imageUri.split(',')[1],
    mimeType: imageUri.split(';')[0].split(':')[1]
  } : undefined;

  // Prompt is mandatory and must be substantial for video generation
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

  const response = await fetch(`${downloadLink}&key=${finalApiKey}`);
  if (!response.ok) {
    throw new Error(`Failed to download generated video: ${response.status} ${response.statusText}`);
  }
  
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};
