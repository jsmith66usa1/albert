
import { GoogleGenAI, Chat, Modality, Type } from "@google/genai";
import { EINSTEIN_SYSTEM_INSTRUCTION } from "../constants";
import { ChatMessage } from "../types";

let ai: GoogleGenAI | null = null;

const getAI = () => {
  if (!ai) {
    if (!process.env.API_KEY) {
      throw new Error("API_KEY environment variable is missing.");
    }
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return ai;
};

export const sendMessageStream = async (message: string, history: ChatMessage[]) => {
  const client = getAI();
  const sdkHistory = history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text.replace(/\[IMAGE:.*?\]/g, '').replace(/\[.*?\]/g, '').trim() }]
  }));

  const chat = client.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: EINSTEIN_SYSTEM_INSTRUCTION,
      temperature: 0.8,
    },
    history: sdkHistory,
  });

  return await chat.sendMessageStream({ message });
};

export const generateScientificImage = async (prompt: string) => {
  const client = getAI();
  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `A high quality scientific illustration of: ${prompt}. Cinematic lighting, intricate details, blackboard aesthetic mixed with cosmic nebulas, realistic yet artistic.` }]
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image generation failed:", error);
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

export const cancelAllPendingTTS = () => {
  // Logic to signal cancellation if needed, usually handled by stopping the source in App.tsx
};

export const generateSpeech = async (text: string): Promise<AudioBuffer | null> => {
  if (!text || text.trim().length < 2) return null;
  
  const client = getAI();
  warmupAudioContext();
  
  try {
    // Simplified prompt to reduce 500 errors and improve stability
    const cleanText = text.replace(/[*#_]/g, '').trim();
    
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Albert Einstein speaks: ${cleanText}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' }, // Resonant, stable scholarly voice
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio || !audioCtx) return null;

    return await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
  } catch (error) {
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
