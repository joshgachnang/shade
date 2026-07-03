import {Badge, Box, Button, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback, useEffect, useState} from "react";
import {FlatList} from "react-native";
import {MovieCharacterCard} from "@/components/MovieCharacterCard";
import {MovieFrameThumbnail} from "@/components/MovieFrameThumbnail";
import {MovieProgressBar} from "@/components/MovieProgressBar";
import {getMovieStatusBadge, isMovieProcessing, movieStatus} from "@/constants/movieStatus";
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

type TabType = "frames" | "characters";

const MovieDetailScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const router = useRouter();
  const {data: movie, isLoading, refetch} = useGetMovieQuery(id);
  const {data: framesData} = useListFramesQuery({movieId: id});
  const {data: charactersData} = useListCharactersQuery({movieId: id});
  const {data: progress} = useGetMovieProgressQuery(id, {
    pollingInterval: isMovieProcessing(movie?.status ?? "") ? 3000 : 0,
  });
  const [processMovie] = useProcessMovieMutation();
  const [cancelMovie] = useCancelMovieMutation();
  const [activeTab, setActiveTab] = useState<TabType>("frames");

  const frames = framesData?.results || [];
  const characters = charactersData?.results || [];

  // Re-fetch the movie record whenever polled progress arrives so the status
  // badge and counts update in near-real-time while frames are being processed.
  useEffect(() => {
    if (progress && isMovieProcessing(movie?.status ?? "")) {
      refetch();
    }
  }, [progress, movie?.status, refetch]);

  const handleProcess = useCallback(async (): Promise<void> => {
    await processMovie(id);
    refetch();
  }, [id, processMovie, refetch]);

  const handleCancel = useCallback(async (): Promise<void> => {
    await cancelMovie(id);
    refetch();
  }, [id, cancelMovie, refetch]);

  const handleFramePress = useCallback(
    (frame: Frame): void => {
      router.push(`/movies/${id}/frames/${frame._id}` as any);
    },
    [router, id]
  );

  const renderFrame = useCallback(
    ({item}: {item: Frame}) => (
      <MovieFrameThumbnail frame={item} movieId={id} onPress={handleFramePress} />
    ),
    [handleFramePress, id]
  );

  const renderCharacter = useCallback(
    ({item}: {item: Character}) => <MovieCharacterCard character={item} />,
    []
  );

  if (isLoading || !movie) {
    return (
      <Page navigation={undefined} title="Movie">
        <Box padding={4} alignItems="center" testID="movie-detail-screen">
          <Box testID="movie-detail-loading-spinner">
            <Spinner />
          </Box>
        </Box>
      </Page>
    );
  }

  const isProcessing = isMovieProcessing(movie.status);

  return (
    <Page navigation={undefined} title={movie.title}>
      <Box padding={4} gap={4} testID="movie-detail-screen">
        {/* Header */}
        <Box gap={2}>
          <Box direction="row" justifyContent="between" alignItems="center">
            <Heading testID="movie-detail-title">{movie.title}</Heading>
            <Badge
              testID="movie-detail-status"
              status={getMovieStatusBadge(movie.status)}
              value={movie.status}
            />
          </Box>

          <Box direction="row" gap={4}>
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
          {!isProcessing && movie.status !== movieStatus.complete && (
            <Button
              testID="movie-detail-process-button"
              text="Start Processing"
              onClick={handleProcess}
            />
          )}
          {isProcessing && (
            <>
              <MovieProgressBar
                processedFrames={progress?.processedFrames ?? 0}
                totalFrames={progress?.totalFrames ?? 0}
                percentage={progress?.percentage}
                height={8}
                testIDPrefix="movie-detail-progress"
              />
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
        <Box direction="row" gap={2}>
          <Button
            testID="movie-detail-tab-frames"
            text={`Frames (${frames.length})`}
            variant={activeTab === "frames" ? "primary" : "outline"}
            onClick={() => setActiveTab("frames")}
          />
          <Button
            testID="movie-detail-tab-characters"
            text={`Characters (${characters.length})`}
            variant={activeTab === "characters" ? "primary" : "outline"}
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
