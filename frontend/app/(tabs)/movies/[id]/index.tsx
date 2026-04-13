import {Badge, Box, Button, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback, useEffect, useState} from "react";
import {FlatList, Image, Pressable} from "react-native";
import {
  type Character,
  type Frame,
  useCancelMovieMutation,
  useGetMovieProgressQuery,
  useGetMovieQuery,
  useListCharactersQuery,
  useListFramesQuery,
  useProcessMovieMutation,
} from "@/store/sdk";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4020";

const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

type TabType = "frames" | "characters";

const MovieDetailScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const router = useRouter();
  const {data: movie, isLoading, refetch} = useGetMovieQuery(id);
  const {data: framesData} = useListFramesQuery({movieId: id});
  const {data: charactersData} = useListCharactersQuery({movieId: id});
  const {data: progress} = useGetMovieProgressQuery(id, {
    pollingInterval: movie?.status === "extracting" || movie?.status === "analyzing" ? 3000 : 0,
  });
  const [processMovie] = useProcessMovieMutation();
  const [cancelMovie] = useCancelMovieMutation();
  const [activeTab, setActiveTab] = useState<TabType>("frames");

  const frames = framesData?.results || [];
  const characters = charactersData?.results || [];

  // Refresh movie data when progress updates
  useEffect(() => {
    if (progress && (movie?.status === "extracting" || movie?.status === "analyzing")) {
      refetch();
    }
  }, [progress, movie?.status, refetch]);

  const handleProcess = useCallback(async () => {
    await processMovie(id);
    refetch();
  }, [id, processMovie, refetch]);

  const handleCancel = useCallback(async () => {
    await cancelMovie(id);
    refetch();
  }, [id, cancelMovie, refetch]);

  const handleFramePress = useCallback(
    (frame: Frame) => {
      router.push(`/movies/${id}/frames/${frame._id}`);
    },
    [router, id]
  );

  const renderFrame = useCallback(
    ({item}: {item: Frame}) => (
      <Pressable onPress={() => handleFramePress(item)} testID={`movie-detail-frame-${item._id}`}>
        <Box width={120} gap={1}>
          <Image
            source={{
              uri: `${API_URL}/static/movies/${id}/frames/frame_${String(item.frameNumber + 1).padStart(6, "0")}.jpg`,
            }}
            style={{width: 120, height: 68, borderRadius: 4}}
            resizeMode="cover"
          />
          <Text size="xs" color="secondaryLight">
            {formatTimestamp(item.timestamp)}
          </Text>
        </Box>
      </Pressable>
    ),
    [handleFramePress, id]
  );

  const renderCharacter = useCallback(
    ({item}: {item: Character}) => (
      <Card testID={`movie-detail-character-${item._id}`}>
        <Box padding={3} gap={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{item.actorName || item.name}</Text>
            <Text size="sm" color="secondaryLight">
              {item.totalAppearances} scenes
            </Text>
          </Box>
          {item.actorName && item.name !== item.actorName && (
            <Text size="sm" color="secondaryLight">
              as {item.name}
            </Text>
          )}
          <Text size="xs" color="secondaryLight">
            {formatTimestamp(item.firstSeen)} - {formatTimestamp(item.lastSeen)}
          </Text>
        </Box>
      </Card>
    ),
    []
  );

  if (isLoading || !movie) {
    return (
      <Page navigation={undefined} title="Movie">
        <Box padding={4} alignItems="center" testID="movie-detail-screen">
          <Spinner testID="movie-detail-loading-spinner" />
        </Box>
      </Page>
    );
  }

  const progressPct = progress?.percentage || 0;
  const isProcessing = movie.status === "extracting" || movie.status === "analyzing";

  return (
    <Page navigation={undefined} title={movie.title}>
      <Box padding={4} gap={4} testID="movie-detail-screen">
        {/* Header */}
        <Box gap={2}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Heading testID="movie-detail-title">{movie.title}</Heading>
            <Badge
              testID="movie-detail-status"
              color={
                movie.status === "complete" ? "green" : movie.status === "error" ? "red" : "blue"
              }
              text={movie.status}
            />
          </Box>

          <Box flexDirection="row" gap={4}>
            {movie.duration > 0 && (
              <Text testID="movie-detail-duration" size="sm" color="secondaryLight">
                {Math.floor(movie.duration / 60)}m {Math.floor(movie.duration % 60)}s
              </Text>
            )}
            {movie.resolution?.width > 0 && (
              <Text testID="movie-detail-resolution" size="sm" color="secondaryLight">
                {movie.resolution.width}x{movie.resolution.height}
              </Text>
            )}
            <Text testID="movie-detail-frame-count" size="sm" color="secondaryLight">
              {movie.frameCount} frames
            </Text>
          </Box>
        </Box>

        {/* Processing controls */}
        <Box gap={2}>
          {!isProcessing && movie.status !== "complete" && (
            <Button
              testID="movie-detail-process-button"
              text="Start Processing"
              onClick={handleProcess}
            />
          )}
          {isProcessing && (
            <>
              <Box testID="movie-detail-progress-bar">
                <Box height={8} backgroundColor="gray.200" borderRadius={4} overflow="hidden">
                  <Box
                    height="100%"
                    width={`${progressPct}%`}
                    backgroundColor="blue.500"
                    borderRadius={4}
                  />
                </Box>
              </Box>
              <Text testID="movie-detail-progress-text" size="sm" textAlign="center">
                {progress?.processedFrames || 0} / {progress?.totalFrames || 0} frames (
                {progressPct}%)
              </Text>
              <Button
                testID="movie-detail-cancel-button"
                text="Cancel"
                variant="outline"
                onClick={handleCancel}
              />
            </>
          )}
        </Box>

        {/* Tabs */}
        <Box flexDirection="row" gap={2}>
          <Button
            testID="movie-detail-tab-frames"
            text={`Frames (${frames.length})`}
            variant={activeTab === "frames" ? "solid" : "outline"}
            onClick={() => setActiveTab("frames")}
          />
          <Button
            testID="movie-detail-tab-characters"
            text={`Characters (${characters.length})`}
            variant={activeTab === "characters" ? "solid" : "outline"}
            onClick={() => setActiveTab("characters")}
          />
        </Box>

        {/* Tab content */}
        {activeTab === "frames" && (
          <FlatList
            testID="movie-detail-frame-grid"
            data={frames}
            renderItem={renderFrame}
            keyExtractor={(item) => item._id}
            numColumns={3}
            columnWrapperStyle={{gap: 8}}
            contentContainerStyle={{gap: 8}}
          />
        )}

        {activeTab === "characters" && (
          <FlatList
            testID="movie-detail-character-list"
            data={characters}
            renderItem={renderCharacter}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{gap: 8}}
          />
        )}
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default MovieDetailScreen;
