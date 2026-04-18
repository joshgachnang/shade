import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {paths} from "../config";
import {Frame, Movie} from "../models";

interface ExtractionResult {
  frameCount: number;
  duration: number;
  fps: number;
  resolution: {width: number; height: number};
}

const getVideoInfo = (
  filePath: string
): Promise<{duration: number; fps: number; width: number; height: number}> => {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data;
    });
    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed with code ${code}: ${stderr}`));
        return;
      }

      const info = JSON.parse(stdout);
      const videoStream = info.streams?.find(
        (s: Record<string, unknown>) => s.codec_type === "video"
      );

      if (!videoStream) {
        reject(new Error("No video stream found"));
        return;
      }

      const fpsStr = videoStream.r_frame_rate || "24/1";
      const [num, den] = fpsStr.split("/").map(Number);
      const fps = den ? num / den : num;

      resolve({
        duration: Number.parseFloat(info.format?.duration || "0"),
        fps,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
      });
    });
  });
};

const extractSceneChangeFrames = (
  filePath: string,
  outputDir: string,
  threshold: number
): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i",
      filePath,
      "-vf",
      `select='gt(scene\\,${threshold})',showinfo`,
      "-vsync",
      "vfr",
      "-q:v",
      "2",
      `${outputDir}/frame_%06d.jpg`,
    ]);

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg scene detection failed with code ${code}: ${stderr.slice(-500)}`));
        return;
      }

      const files = await fs.readdir(outputDir);
      const frames = files.filter((f) => f.startsWith("frame_") && f.endsWith(".jpg")).sort();

      resolve(frames);
    });
  });
};

const extractIntervalFrames = (
  filePath: string,
  outputDir: string,
  intervalSeconds: number
): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i",
      filePath,
      "-vf",
      `fps=1/${intervalSeconds}`,
      "-q:v",
      "2",
      `${outputDir}/frame_%06d.jpg`,
    ]);

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", async (code) => {
      if (code !== 0) {
        reject(
          new Error(`FFmpeg interval extraction failed with code ${code}: ${stderr.slice(-500)}`)
        );
        return;
      }

      const files = await fs.readdir(outputDir);
      const frames = files.filter((f) => f.startsWith("frame_") && f.endsWith(".jpg")).sort();

      resolve(frames);
    });
  });
};

const extractEveryFrame = (filePath: string, outputDir: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-i", filePath, "-q:v", "2", `${outputDir}/frame_%06d.jpg`]);

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", async (code) => {
      if (code !== 0) {
        reject(
          new Error(`FFmpeg frame extraction failed with code ${code}: ${stderr.slice(-500)}`)
        );
        return;
      }

      const files = await fs.readdir(outputDir);
      const frames = files.filter((f) => f.startsWith("frame_") && f.endsWith(".jpg")).sort();

      resolve(frames);
    });
  });
};

const getFrameTimestamps = (
  filePath: string,
  mode: string,
  threshold: number
): Promise<number[]> => {
  return new Promise((resolve, _reject) => {
    let filterExpr: string;
    if (mode === "scene-change") {
      filterExpr = `select='gt(scene\\,${threshold})',showinfo`;
    } else {
      filterExpr = "showinfo";
    }

    const proc = spawn("ffmpeg", ["-i", filePath, "-vf", filterExpr, "-f", "null", "-"]);

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", () => {
      const timestamps: number[] = [];
      const regex = /pts_time:(\d+\.?\d*)/g;
      let match: RegExpExecArray | null = regex.exec(stderr);
      while (match !== null) {
        timestamps.push(Number.parseFloat(match[1]));
        match = regex.exec(stderr);
      }
      resolve(timestamps);
    });
  });
};

export const extractFrames = async (movieId: string): Promise<ExtractionResult> => {
  const movie = await Movie.findExactlyOne({_id: movieId});
  const filePath = movie.filePath;

  // Verify file exists
  await fs.access(filePath);

  // Get video info
  const videoInfo = await getVideoInfo(filePath);
  logger.info(
    `Video info: ${videoInfo.duration}s, ${videoInfo.fps}fps, ${videoInfo.width}x${videoInfo.height}`
  );

  // Create output directory
  const outputDir = path.join(paths.movies, movieId, "frames");
  await fs.mkdir(outputDir, {recursive: true});

  // Extract frames based on mode
  const config = movie.extractionConfig;
  const mode = config?.mode || "scene-change";
  let frameFiles: string[];

  if (mode === "scene-change") {
    const threshold = config?.sceneThreshold || 0.3;
    frameFiles = await extractSceneChangeFrames(filePath, outputDir, threshold);
  } else if (mode === "interval") {
    const interval = config?.intervalSeconds || 1;
    frameFiles = await extractIntervalFrames(filePath, outputDir, interval);
  } else {
    frameFiles = await extractEveryFrame(filePath, outputDir);
  }

  logger.info(`Extracted ${frameFiles.length} frames from ${filePath}`);

  // Get timestamps — only run FFmpeg timestamp pass for scene-change mode
  // For interval/every-frame, timestamps are computed mathematically
  let timestamps: number[] = [];
  if (mode === "scene-change") {
    timestamps = await getFrameTimestamps(filePath, mode, config?.sceneThreshold || 0.3);
  }

  // Create Frame documents
  for (let i = 0; i < frameFiles.length; i++) {
    const framePath = path.join(outputDir, frameFiles[i]);
    const stat = await fs.stat(framePath);

    let timestamp: number;
    if (mode === "interval") {
      timestamp = i * (config?.intervalSeconds || 1);
    } else if (mode === "every-frame") {
      timestamp = videoInfo.fps > 0 ? i / videoInfo.fps : i;
    } else {
      timestamp = timestamps[i] ?? (i / frameFiles.length) * videoInfo.duration;
    }

    await Frame.create({
      movieId,
      frameNumber: i,
      timestamp,
      imagePath: framePath,
      width: videoInfo.width,
      height: videoInfo.height,
      fileSizeBytes: stat.size,
      status: "pending",
    });
  }

  // Update movie with video info
  movie.duration = videoInfo.duration;
  movie.fps = videoInfo.fps;
  movie.resolution = {width: videoInfo.width, height: videoInfo.height};
  movie.frameCount = frameFiles.length;
  await movie.save();

  return {
    frameCount: frameFiles.length,
    duration: videoInfo.duration,
    fps: videoInfo.fps,
    resolution: {width: videoInfo.width, height: videoInfo.height},
  };
};
