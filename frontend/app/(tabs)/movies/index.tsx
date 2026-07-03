import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  Modal,
  Page,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useState} from "react";
import {FlatList, Pressable} from "react-native";
import {MovieProgressBar} from "@/components/MovieProgressBar";
import {getMovieStatusBadge, isMovieProcessing} from "@/constants/movieStatus";
import {type Movie, useCreateMovieMutation, useListMoviesQuery} from "@/store/sdk";

interface AddMovieFormState {
  title: string;
  filePath: string;
  actors: string;
}

const emptyForm: AddMovieFormState = {title: "", filePath: "", actors: ""};

const MovieListScreen: React.FC = () => {
  const router = useRouter();
  const {data, isLoading, refetch} = useListMoviesQuery();
  const [createMovie, {isLoading: isCreating}] = useCreateMovieMutation();
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<AddMovieFormState>(emptyForm);

  const movies = data?.results || [];

  const handleOpenAdd = useCallback((): void => {
    setForm(emptyForm);
    setModalVisible(true);
  }, []);

  const handleDismissAdd = useCallback((): void => {
    setModalVisible(false);
  }, []);

  const handleFormChange = useCallback(
    (field: keyof AddMovieFormState) =>
      (value: string): void => {
        setForm((prev) => ({...prev, [field]: value}));
      },
    []
  );

  const handleSubmitAdd = useCallback(async (): Promise<void> => {
    const title = form.title.trim();
    const filePath = form.filePath.trim();
    if (!title || !filePath) {
      return;
    }
    const actors = form.actors
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    await createMovie({title, filePath, actors});
    setModalVisible(false);
    refetch();
  }, [createMovie, form, refetch]);

  const handleMoviePress = useCallback(
    (movie: Movie) => {
      router.push(`/movies/${movie._id}` as any);
    },
    [router]
  );

  const renderMovie = useCallback(
    ({item}: {item: Movie}) => {
      return (
        <Pressable onPress={() => handleMoviePress(item)} testID={`movies-item-${item._id}`}>
          <Card>
            <Box padding={3} gap={2}>
              <Box direction="row" justifyContent="between" alignItems="center">
                <Heading size="sm">{item.title}</Heading>
                <Badge
                  testID={`movies-item-${item._id}-status`}
                  status={getMovieStatusBadge(item.status)}
                  value={item.status}
                />
              </Box>
              {item.duration > 0 && (
                <Text color="secondaryLight" size="sm">
                  {Math.floor(item.duration / 60)}m {Math.floor(item.duration % 60)}s{" | "}
                  {item.frameCount} frames
                </Text>
              )}
              {isMovieProcessing(item.status) && (
                <Box testID={`movies-item-${item._id}-progress`}>
                  <MovieProgressBar
                    processedFrames={item.processedFrameCount}
                    totalFrames={item.frameCount}
                  />
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

  const canSubmit = form.title.trim().length > 0 && form.filePath.trim().length > 0;

  return (
    <Page navigation={undefined} title="Movies">
      <Box padding={4} gap={4} testID="movies-screen">
        <Box direction="row" justifyContent="between" alignItems="center">
          <Heading>Movies</Heading>
          <Button testID="movies-upload-button" text="Add Movie" onClick={handleOpenAdd} />
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

        <Modal
          visible={modalVisible}
          title="Add Movie"
          subtitle="Point Shade at a local video file to extract and analyze frames."
          primaryButtonText={isCreating ? "Adding..." : "Add Movie"}
          primaryButtonDisabled={!canSubmit || isCreating}
          secondaryButtonText="Cancel"
          primaryButtonOnClick={handleSubmitAdd}
          secondaryButtonOnClick={handleDismissAdd}
          onDismiss={handleDismissAdd}
        >
          <Box gap={3} testID="movies-add-modal">
            <TextField
              testID="movies-add-title"
              title="Title"
              value={form.title}
              onChange={handleFormChange("title")}
            />
            <TextField
              testID="movies-add-filepath"
              title="File path"
              helperText="Absolute path on the Shade server (e.g. /movies/Heat.mkv)."
              value={form.filePath}
              onChange={handleFormChange("filePath")}
            />
            <TextField
              testID="movies-add-actors"
              title="Actors"
              helperText="Comma-separated, optional."
              value={form.actors}
              onChange={handleFormChange("actors")}
            />
          </Box>
        </Modal>
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default MovieListScreen;
