import {createHmac} from "node:crypto";
import {logger} from "@terreno/api";

export interface SongMatch {
  artist: string;
  title: string;
  album?: string;
}

/**
 * Submit a WAV audio sample to ACRCloud's identify API and return the top
 * music match, or null if there's no match (or ACRCloud errored — errors are
 * logged and swallowed since song ID is best-effort background work).
 */
export const queryAcrCloud = async (args: {
  audioBuffer: Buffer;
  accessKey: string;
  secretKey: string;
}): Promise<SongMatch | null> => {
  const {audioBuffer, accessKey, secretKey} = args;
  const host = "identify-us-west-2.acrcloud.com";
  const endpoint = "/v1/identify";
  const httpMethod = "POST";
  const httpUri = endpoint;
  const dataType = "audio";
  const signatureVersion = "1";
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const stringToSign = [httpMethod, httpUri, accessKey, dataType, signatureVersion, timestamp].join(
    "\n"
  );
  const signature = createHmac("sha1", secretKey).update(stringToSign).digest("base64");

  const form = new FormData();
  form.append("sample", new Blob([audioBuffer]), "audio.wav");
  form.append("sample_bytes", audioBuffer.length.toString());
  form.append("access_key", accessKey);
  form.append("data_type", dataType);
  form.append("signature_version", signatureVersion);
  form.append("signature", signature);
  form.append("timestamp", timestamp);

  const response = await fetch(`https://${host}${endpoint}`, {method: "POST", body: form});

  if (!response.ok) {
    logger.error(`ACRCloud returned ${response.status}: ${await response.text()}`);
    return null;
  }

  const data = (await response.json()) as {
    status?: {code?: number; msg?: string};
    metadata?: {
      music?: Array<{
        title?: string;
        album?: {name?: string};
        artists?: Array<{name: string}>;
      }>;
    };
  };

  if (data.status?.code !== 0) {
    logger.debug(`ACRCloud no match: ${data.status?.msg} (code ${data.status?.code})`);
    return null;
  }

  const music = data.metadata?.music?.[0];
  if (!music) {
    return null;
  }

  return {
    artist: music.artists?.map((a) => a.name).join(", ") || "Unknown Artist",
    title: music.title || "Unknown Title",
    album: music.album?.name,
  };
};
