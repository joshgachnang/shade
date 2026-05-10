import {Badge, Box, Button, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {FlatList, Pressable} from "react-native";
import {type Feature, useCreateFeatureMutation, useListFeaturesQuery} from "@/store/sdk";

const statusToVariant: Record<string, "info" | "success" | "error" | "warning" | "neutral"> = {
  planned: "neutral",
  in_progress: "info",
  paused: "warning",
  complete: "success",
  error: "error",
};

const FeatureListScreen: React.FC = () => {
  const router = useRouter();
  const {data, isLoading, refetch} = useListFeaturesQuery(undefined);
  const [createFeature] = useCreateFeatureMutation();

  const features = data?.results || [];

  const handleAddFeature = useCallback(async () => {
    const name = prompt("Feature name:");
    if (!name) {
      return;
    }
    const description = prompt("Description (optional):");

    await createFeature({
      name,
      description: description || undefined,
      steps: [],
    });
    refetch();
  }, [createFeature, refetch]);

  const handleFeaturePress = useCallback(
    (feature: Feature) => {
      router.push(`/features/${feature._id}` as any);
    },
    [router]
  );

  const renderFeature = useCallback(
    ({item}: {item: Feature}) => {
      const completedSteps = item.steps.filter(
        (s) => s.status === "complete" || s.status === "skipped"
      ).length;
      const totalSteps = item.steps.length;
      const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

      return (
        <Pressable onPress={() => handleFeaturePress(item)} testID={`features-item-${item._id}`}>
          <Card>
            <Box padding={3} gap={2}>
              <Box direction="row" justifyContent="between" alignItems="center">
                <Heading size="sm">{item.name}</Heading>
                <Badge
                  testID={`features-item-${item._id}-status`}
                  status={statusToVariant[item.status] || "neutral"}
                  value={item.status.replace("_", " ")}
                />
              </Box>
              {item.description && (
                <Text color="secondaryLight" size="sm">
                  {item.description}
                </Text>
              )}
              {totalSteps > 0 && (
                <Box gap={1}>
                  <Box height={4} rounding="sm" overflow="hidden" color="neutralLight">
                    <Box height="100%" width={`${percentage}%`} color="primary" rounding="sm" />
                  </Box>
                  <Text size="sm" color="secondaryLight">
                    {completedSteps} / {totalSteps} steps ({percentage}%)
                  </Text>
                </Box>
              )}
              {item.status === "in_progress" && item.currentStepIndex < item.steps.length && (
                <Text size="sm" color="link">
                  Current: {item.steps[item.currentStepIndex].name}
                </Text>
              )}
              {item.errorMessage && (
                <Text size="sm" color="error">
                  {item.errorMessage}
                </Text>
              )}
            </Box>
          </Card>
        </Pressable>
      );
    },
    [handleFeaturePress]
  );

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Features">
        <Box padding={4} alignItems="center" testID="features-screen">
          <Box testID="features-loading-spinner">
            <Spinner />
          </Box>
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="Features">
      <Box padding={4} gap={4} testID="features-screen">
        <Box direction="row" justifyContent="between" alignItems="center">
          <Heading>Features</Heading>
          <Button testID="features-add-button" text="Add Feature" onClick={handleAddFeature} />
        </Box>

        {features.length === 0 ? (
          <Box testID="features-empty-state" padding={8} alignItems="center">
            <Text color="secondaryLight">No features yet. Add one to get started.</Text>
          </Box>
        ) : (
          <FlatList
            testID="features-list"
            data={features}
            renderItem={renderFeature}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{gap: 12}}
          />
        )}
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default FeatureListScreen;
