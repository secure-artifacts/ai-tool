import { GoogleGenAI, Modality } from "@google/genai";
import { Layer } from '../types';
import { ChatMessage } from '../AIImageEditorApp';

const getAiInstance = () => {
  const storedKey = typeof window !== 'undefined' ? localStorage.getItem('user_api_key') : null;
  const keyToUse = storedKey || process.env.API_KEY;
  if (!keyToUse) {
    throw new Error('API key is not set. 请先在顶部的 API Key 按钮中配置可用的 Google AI Key。');
  }
  return new GoogleGenAI({ apiKey: keyToUse });
};

const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

const dataUrlToGenerativePart = async (dataUrl: string) => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], "masked_image.png", { type: "image/png" });
  return fileToGenerativePart(file);
};

const createCompositeImage = (baseImageFile: File, maskCanvas: HTMLCanvasElement): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const baseImage = new Image();
      baseImage.onload = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = baseImage.naturalWidth;
        tempCanvas.height = baseImage.naturalHeight;
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) {
          return reject(new Error("Failed to get 2D context"));
        }
        ctx.drawImage(baseImage, 0, 0);
        ctx.drawImage(maskCanvas, 0, 0);
        resolve(tempCanvas.toDataURL('image/png'));
      };
      baseImage.onerror = reject;
      baseImage.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(baseImageFile);
  });
};

const isCanvasBlank = (canvas: HTMLCanvasElement): boolean => {
  const context = canvas.getContext('2d');
  if (!context) return true;
  const pixelBuffer = new Uint32Array(
    context.getImageData(0, 0, canvas.width, canvas.height).data.buffer
  );
  return !pixelBuffer.some(pixel => pixel !== 0);
};

const generateImage = async (
  baseImage: File,
  maskCanvas: HTMLCanvasElement | null,
  prompt: string,
  model = 'gemini-2.5-flash-image',
  imageResolution = '1K'
): Promise<string> => {
  const imageParts = [];

  if (maskCanvas && !isCanvasBlank(maskCanvas)) {
    const compositeDataUrl = await createCompositeImage(baseImage, maskCanvas);
    imageParts.push(await dataUrlToGenerativePart(compositeDataUrl));
    prompt += '\n\n**Masking Instructions:** The input image contains colored markings (like brush strokes or boxes). These markings indicate the specific areas of interest for the operation. Focus your changes within these marked regions. The color of the markings has no special meaning other than to highlight an area.';
  } else {
    imageParts.push(await fileToGenerativePart(baseImage));
  }

  const contents = {
    parts: [
      ...imageParts,
      { text: prompt },
    ],
  };

  try {
    const ai = getAiInstance();
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        responseModalities: [Modality.IMAGE],
        imageSize: imageResolution,
      } as any,
    });

    if (response?.candidates?.length > 0 && response.candidates[0].content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64ImageBytes: string = part.inlineData.data;
          const mimeType: string = part.inlineData.mimeType;
          return `data:${mimeType};base64,${base64ImageBytes}`;
        }
      }
    }

    let errorMessage = '未生成图像。请检查您的提示和图像。';
    if (response?.promptFeedback?.blockReason) {
      errorMessage = `请求因安全策略被拒绝 (${response.promptFeedback.blockReason}).`;
    } else if (!response?.candidates || response.candidates.length === 0) {
      errorMessage = '请求成功，但模型未返回任何内容。这可能是由于内容安全策略。';
    }

    throw new Error(errorMessage);
  } catch (e: unknown) {
    console.error(e);
    if (e instanceof Error) {
      throw e;
    }
    throw new Error('生成图像时发生未知网络或API错误。');
  }
};

const mergeLayers = async (
  layers: Layer[],
  canvasSize: { width: number; height: number },
  prompt: string,
  model = 'gemini-2.5-flash-image',
  imageResolution = '1K'
): Promise<string> => {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvasSize.width;
  tempCanvas.height = canvasSize.height;
  const ctx = tempCanvas.getContext('2d');
  if (!ctx) {
    throw new Error("Failed to create temporary canvas for merging");
  }

  const loadedImages = await Promise.all(layers.map(layer => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = layer.imageUrl;
    });
  }));

  layers.forEach((layer, index) => {
    const img = loadedImages[index];
    const destWidth = img.naturalWidth * layer.scale;
    const destHeight = img.naturalHeight * layer.scale;
    ctx.drawImage(img, layer.x, layer.y, destWidth, destHeight);
  });

  const compositeBlob = await new Promise<Blob | null>(resolve => tempCanvas.toBlob(resolve, 'image/png'));
  if (!compositeBlob) {
    throw new Error("Failed to create blob from merged canvas");
  }

  const compositeFile = new File([compositeBlob], "composite.png", { type: 'image/png' });
  const fullPrompt = `Based on the provided composite image, seamlessly merge the foreground elements with the background scene. Pay close attention to lighting, shadows, scale, and perspective to create a cohesive and realistic final image. The user's original prompt was: "${prompt}"`;

  return generateImage(compositeFile, null, fullPrompt, model, imageResolution);
};

const extractStyle = async (baseImage: File, model = 'gemini-3-flash-preview'): Promise<string> => {
  const ai = getAiInstance();
  const imagePart = await fileToGenerativePart(baseImage);
  const prompt = `Thoroughly analyze the artistic style of the provided image. Pay close attention to elements like: color palette and harmony, lighting techniques (e.g., soft, dramatic, chiaroscuro), brushwork or texture (e.g., detailed, impasto, smooth), overall mood and atmosphere, and any identifiable art movement influences (e.g., impressionism, realism, surrealism). Based on this comprehensive analysis, generate a detailed and descriptive prompt in Chinese for an AI image generator. The prompt should be a single, cohesive paragraph that eloquently captures the essence of the style, enabling another AI to replicate it. Crucially, DO NOT describe the subject matter (people, objects, places) of the image; focus exclusively on the stylistic and artistic qualities.`

  const contents = {
    parts: [
      imagePart,
      { text: prompt },
    ],
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents,
    });

    return response.text.trim();
  } catch (e: unknown) {
    console.error(e);
    if (e instanceof Error) {
      throw e;
    }
    throw new Error('An unknown network or API error occurred while extracting style.');
  }
};

const chatWithPromptHelper = async (
  history: ChatMessage[],
  imageFile?: File,
  model = 'gemini-3-flash-preview',
): Promise<string> => {
  const ai = getAiInstance();
  const systemInstruction = `You are a world-class AI art prompt engineer. Your primary language is Chinese.
Your task is to collaborate with a user to create a detailed and effective image generation prompt. The user will provide ideas, and you will refine them into a better prompt in Chinese.
- **Analyze**: Understand the user's core idea.
- **Enhance**: Add descriptive adjectives, suggest lighting, composition, and artistic style.
- **Format**: Structure it as a cohesive paragraph.
- **Output**: Your entire response must be **only** the new, improved prompt, written in **Chinese**. Do not add any conversational text. If the user provides an image and asks questions about it (e.g., "describe this image"), your response should be a description in Chinese.

Example 1:
User: 一只猫
Your Response: 一只雄伟的猫，有着闪亮的翠绿色眼睛，柔软的皮毛以逼真的细节呈现，庄严地坐在柔软、温暖的画室灯光下的天鹅绒垫子上。

Example 2:
User (after your response above): 把它变成一只黑猫
Your Response: 一只雄伟的黑猫，有着闪亮的翠绿色眼睛，其深色的皮毛以逼真的细节呈现，庄严地坐在柔软、温暖的画室灯光下的天鹅绒垫子上.`;

  const contents = history.map(turn => ({
    role: turn.role,
    parts: [{ text: turn.text }] as ({ text: string } | { inlineData: { data: string; mimeType: string } })[],
  }));

  if (imageFile && contents.length > 0) {
    const lastTurn = contents[contents.length - 1];
    if (lastTurn.role === 'user') {
      const imagePart = await fileToGenerativePart(imageFile);
      lastTurn.parts.unshift(imagePart);
    }
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
      },
    });
    return response.text.trim();
  } catch (e: unknown) {
    console.error(e);
    if (e instanceof Error) {
      throw e;
    }
    throw new Error('An unknown network or API error occurred during prompt refinement.');
  }
};

export const geminiService = {
  generateImage,
  mergeLayers,
  extractStyle,
  chatWithPromptHelper,
};
