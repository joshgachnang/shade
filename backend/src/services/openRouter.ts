import fs from "node:fs/promises";
import {logger} from "@terreno/api";

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{type: string; text?: string; image_url?: {url: string}}>;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    total_tokens: number;
  };
}

export interface VisionAnalysisRequest {
  imagePath: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface VisionAnalysisResponse {
  content: string;
  tokensUsed: number;
  model: string;
}

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const getApiKey = (): string => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY environment variable is not set");
  }
  return key;
};

export const analyzeImage = async (request: VisionAnalysisRequest): Promise<VisionAnalysisResponse> => {
  const apiKey = getApiKey();

  // Read image and convert to base64
  const imageBuffer = await fs.readFile(request.imagePath);
  const base64Image = imageBuffer.toString("base64");
  const mimeType = request.imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: request.systemPrompt,
    },
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {url: dataUrl},
        },
        {
          type: "text",
          text: request.userPrompt,
        },
      ],
    },
  ];

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://shade.app",
    },
    body: JSON.stringify({
      model: request.model,
      messages,
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as OpenRouterResponse;

  if (!data.choices?.[0]?.message?.content) {
    throw new Error("No content in OpenRouter response");
  }

  return {
    content: data.choices[0].message.content,
    tokensUsed: data.usage?.total_tokens || 0,
    model: request.model,
  };
};
