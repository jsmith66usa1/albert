
import { GoogleGenAI, Modality } from "@google/genai";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export async function generateEinsteinResponse(prompt: string, history: { role: string, parts: { text: string }[] }[]) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: history.concat([{ role: 'user', parts: [{ text: prompt }] }]),
    config: {
      systemInstruction: "You are Professor Albert Einstein. Speak with a warm, humble, whimsical, and academic tone. Address the user as 'My dear friend'. Use metaphors to explain complex concepts. Use LaTeX for equations wrapped in $ or $$. If you introduce a new visual topic, generate a tag exactly like [IMAGE: prompt] describing a chalkboard-style scientific illustration.",
      temperature: 0.8,
    },
  });
  return response.text;
}

export async function generateChalkboardImage(prompt: string): Promise<string> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ text: `A professional chalkboard scientific drawing of: ${prompt}. High-contrast white chalk strokes on a dusty black chalkboard background. Include scientific diagrams, handwritten formulas, and elegant minimalist line art. Moody atmosphere, academic look.` }],
    config: {
      imageConfig: { aspectRatio: "1:1" }
    }
  });

  // Handle various response patterns
  if (response.candidates && response.candidates[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }
  
  throw new Error("The scientific manifestation failed to materialize (No image part found).");
}

export async function generateEinsteinSpeech(text: string): Promise<string> {
  const ai = getAI();
  // Filter out the image tags before speaking
  const speechText = text.replace(/\[IMAGE:.*?\]/g, '').trim();
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Say with a mature, gentle, intellectual German-accented warmth: ${speechText}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Charon' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio generated");
  return base64Audio;
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
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
