import {Badge, Box, Button, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {FlatList, Pressable} from "react-native";
import {type Movie, useCreateMovieMutation, useListMoviesQuery} from "@/store/sdk";

const statusToStatus: Record<string, "info" | "success" | "error" | "warning" | "neutral"> = {
  pending: "neutral",
  extracting: "info",
  analyzing: "warning",
  complete: "success",
  error: "error",
};

const MovieListScreen: React.FC = () => {
  const router = useRouter();
  const {data, isLoading, refetch} = useListMoviesQuery();
  const [createMovie] = useCreateMovieMutation();

  const movies = data?.results || [];

  const handleAddMovie = useCallback(async () => {
    const title = prompt("Movie title:");
    if (!title) {
      return;
    }
    const filePath = prompt("File path to movie:");
    if (!filePath) {
      return;
    }
    const actors = prompt("Actor names (comma-separated, optional):");

    await createMovie({
      title,
      filePath,
      actors: actors ? actors.split(",").map((a) => a.trim()) : [],
    });
    refetch();
  }, [createMovie, refetch]);

  const handleMoviePress = useCallback(
    (movie: Movie) => {
      router.push(`/movies/${movie._id}` as any);
    },
    [router]
  );

  const renderMovie = useCallback(
    ({item}: {item: Movie}) => {
      const progress =
        item.frameCount > 0 ? Math.round((item.processedFrameCount / item.frameCount) * 100) : 0;

      return (
        <Pressable onPress={() => handleMoviePress(item)} testID={`movies-item-${item._id}`}>
          <Card>
            <Box padding={3} gap={2}>
              <Box direction="row" justifyContent="between" alignItems="center">
                <Heading size="sm">{item.title}</Heading>
                <Badge
                  testID={`movies-item-${item._id}-status`}
                  status={statusToStatus[item.status] || "neutral"}
                  value={item.status}
                />
              </Box>
              {item.duration > 0 && (
                <Text color="secondaryLight" size="sm">
                  {Math.floor(item.duration / 60)}m {Math.floor(item.duration % 60)}s{" | "}
                  {item.frameCount} frames
                </Text>
              )}
              {(item.status === "extracting" || item.status === "analyzing") && (
                <Box testID={`movies-item-${item._id}-progress`} gap={1}>
                  <Box height={4} rounding="sm" overflow="hidden" color="neutralLight">
                    <Box height="100%" width={`${progress}%`} color="primary" rounding="sm" />
                  </Box>
                  <Text size="sm" color="secondaryLight">
                    {item.processedFrameCount} / {item.frameCount} frames ({progress}%)
                  </Text>
                </Box>
              )}
            </Box>
          </Card>
        </Pressable>
      );
    },
    [handleMoviePress]
  );

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Movies">
        <Box padding={4} alignItems="center" testID="movies-screen">
          <Box testID="movies-loading-spinner">
            <Spinner />
          </Box>
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="Movies">
      <Box padding={4} gap={4} testID="movies-screen">
        <Box direction="row" justifyContent="between" alignItems="center">
          <Heading>Movies</Heading>
          <Button testID="movies-upload-button" text="Add Movie" onClick={handleAddMovie} />
        </Box>

        {movies.length === 0 ? (
          <Box testID="movies-empty-state" padding={8} alignItems="center">
            <Text color="secondaryLight">No movies yet. Add one to get started.</Text>
          </Box>
        ) : (
          <FlatList
            testID="movies-list"
            data={movies}
            renderItem={renderMovie}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{gap: 12}}
          />
        )}
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default MovieListScreen;
