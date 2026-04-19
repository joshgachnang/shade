import {spawn} from "node:child_process";

/**
 * Wrap a raw PCM buffer in a WAV container so it can be submitted to services
 * like ACRCloud that expect a file-like audio blob. Input must be linear PCM
 * with the specified sample rate, channel count, and bit depth.
 */
export const wrapPcmAsWav = (
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer => {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

/**
 * Transcode raw 16 kHz / mono / s16le PCM to MP3 using a local ffmpeg binary.
 * Takes `ffmpegPath` rather than hardcoding so tests can stub it and so the
 * caller stays in control of which ffmpeg is used (`which ffmpeg` hits vary).
 */
export const pcmToMp3 = (pcm: Buffer, ffmpegPath: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegPath,
      [
        "-f",
        "s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-codec:a",
        "libmp3lame",
        "-qscale:a",
        "5",
        "-f",
        "mp3",
        "pipe:1",
      ],
      {stdio: ["pipe", "pipe", "pipe"]}
    );

    const chunks: Buffer[] = [];
    let stderr = "";

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.end(pcm);
  });
};
