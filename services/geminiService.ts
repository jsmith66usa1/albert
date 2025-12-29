import { GoogleGenAI, Modality } from "@google/genai";
import { EINSTEIN_SYSTEM_INSTRUCTION } from "../constants";
import { ChatMessage } from "../types";

const getAI = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY environment variable is missing.");
  }
  return new GoogleGenAI({ apiKey });
};

export const sendMessageStream = async (message: string, history: ChatMessage[]) => {
  const ai = getAI();
  const sdkHistory = history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text.replace(/\[IMAGE:.*?\]/g, '').replace(/\[.*?\]/g, '').trim() }]
  }));

  const chat = ai.chats.create({
    model: 'gemini-3-pro-preview',
    config: {
      systemInstruction: EINSTEIN_SYSTEM_INSTRUCTION,
      temperature: 0.65,
    },
    history: sdkHistory,
  });

  return await chat.sendMessageStream({ message });
};

export const generateScientificImage = async (prompt: string) => {
  const ai = getAI();
  try {
    // Safer, more specific educational prompt to ensure consistency
    const optimizedPrompt = `Scientific concept visual: ${prompt}. Chalkboard style, clean white lines on dark background, educational illustration, clear mathematical diagrams. Professional museum quality.`;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{
        parts: [{ text: optimizedPrompt }]
      }],
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return part.inlineData.data; // Return raw base64 string
        }
      }
    }
    return null;
  } catch (error) {
    console.error("Einstein Visual generation failed:", error);
    return null;
  }
};

let audioCtx: AudioContext | null = null;

export const warmupAudioContext = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
};

export const generateSpeech = async (text: string): Promise<AudioBuffer | null> => {
  if (!text || text.trim().length < 2) return null;
  
  const ai = getAI();
  warmupAudioContext();
  
  try {
    const cleanText = text.replace(/[*#_]/g, '').trim();
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Professor Albert Einstein speaking: ${cleanText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio || !audioCtx) return null;

    return await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
  } catch (error: any) {
    if (error?.message?.includes('429') || error?.message?.includes('quota')) {
      console.warn("TTS Quota exceeded. Einstein is resting his voice.");
      throw new Error("QUOTA_EXCEEDED");
    }
    console.error("TTS generation failed:", error);
    return null;
  }
};

export const playAudioBuffer = async (buffer: AudioBuffer): Promise<AudioBufferSourceNode | null> => {
  if (!audioCtx) return null;
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  source.start();
  return source;
};

export const cancelAllPendingTTS = () => {
  // logic handled by sessionID in App
};

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}