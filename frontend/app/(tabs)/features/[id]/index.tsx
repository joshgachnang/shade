import {Badge, Box, Button, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {FlatList} from "react-native";
import {
  type FeatureStep,
  useGetFeatureQuery,
  usePauseFeatureMutation,
  useResumeFeatureMutation,
} from "@/store/sdk";

const stepStatusToVariant: Record<string, "info" | "success" | "error" | "warning" | "neutral"> = {
  pending: "neutral",
  in_progress: "info",
  complete: "success",
  error: "error",
  skipped: "warning",
};

const FeatureDetailScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const {data: feature, isLoading, refetch} = useGetFeatureQuery(id);
  const [resumeFeature, {isLoading: isResuming}] = useResumeFeatureMutation();
  const [pauseFeature, {isLoading: isPausing}] = usePauseFeatureMutation();

  const handleResume = useCallback(async () => {
    if (!feature) {
      return;
    }
    await resumeFeature(feature._id);
    refetch();
  }, [feature, resumeFeature, refetch]);

  const handlePause = useCallback(async () => {
    if (!feature) {
      return;
    }
    await pauseFeature(feature._id);
    refetch();
  }, [feature, pauseFeature, refetch]);

  const renderStep = useCallback(
    ({item, index}: {item: FeatureStep; index: number}) => {
      const isCurrent = feature && index === feature.currentStepIndex;

      return (
        <Card testID={`feature-step-${index}`}>
          <Box padding={3} gap={2}>
            <Box direction="row" justifyContent="between" alignItems="center">
              <Box direction="row" gap={2} alignItems="center">
                <Text size="sm" color="secondaryLight">
                  {index + 1}.
                </Text>
                <Text bold={isCurrent}>{item.name}</Text>
              </Box>
              <Badge
                testID={`feature-step-${index}-status`}
                status={stepStatusToVariant[item.status] || "neutral"}
                value={item.status.replace("_", " ")}
              />
            </Box>
            {item.description && (
              <Text size="sm" color="secondaryLight">
                {item.description}
              </Text>
            )}
            {item.result && (
              <Box padding={2} color="successLight" rounding="sm">
                <Text size="sm">{item.result}</Text>
              </Box>
            )}
            {item.errorMessage && (
              <Box padding={2} color="errorLight" rounding="sm">
                <Text size="sm" color="error">
                  {item.errorMessage}
                </Text>
              </Box>
            )}
            {item.startedAt && (
              <Text size="sm" color="secondaryLight">
                Started: {new Date(item.startedAt).toLocaleString()}
                {item.completedAt && ` | Completed: ${new Date(item.completedAt).toLocaleString()}`}
              </Text>
            )}
          </Box>
        </Card>
      );
    },
    [feature]
  );

  if (isLoading || !feature) {
    return (
      <Page navigation={undefined} title="Feature">
        <Box padding={4} alignItems="center" testID="feature-detail-screen">
          <Spinner />
        </Box>
      </Page>
    );
  }

  const completedSteps = feature.steps.filter(
    (s) => s.status === "complete" || s.status === "skipped"
  ).length;
  const totalSteps = feature.steps.length;
  const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <Page navigation={undefined} title={feature.name}>
      <Box padding={4} gap={4} testID="feature-detail-screen">
        <Box gap={2}>
          <Box direction="row" justifyContent="between" alignItems="center">
            <Heading>{feature.name}</Heading>
            <Badge
              testID="feature-detail-status"
              status={stepStatusToVariant[feature.status] || "neutral"}
              value={feature.status.replace("_", " ")}
            />
          </Box>
          {feature.description && <Text color="secondaryLight">{feature.description}</Text>}
        </Box>

        {totalSteps > 0 && (
          <Box gap={1}>
            <Box height={6} rounding="sm" overflow="hidden" color="neutralLight">
              <Box height="100%" width={`${percentage}%`} color="primary" rounding="sm" />
            </Box>
            <Text size="sm" color="secondaryLight">
              {completedSteps} / {totalSteps} steps complete ({percentage}%)
            </Text>
          </Box>
        )}

        {feature.errorMessage && (
          <Box padding={3} color="errorLight" rounding="sm">
            <Text color="error">{feature.errorMessage}</Text>
          </Box>
        )}

        <Box direction="row" gap={2}>
          {(feature.status === "error" || feature.status === "paused") && (
            <Button
              testID="feature-resume-button"
              text={isResuming ? "Resuming..." : "Resume"}
              onClick={handleResume}
              disabled={isResuming}
            />
          )}
          {feature.status === "in_progress" && (
            <Button
              testID="feature-pause-button"
              text={isPausing ? "Pausing..." : "Pause"}
              onClick={handlePause}
              disabled={isPausing}
              variant="secondary"
            />
          )}
        </Box>

        <Box gap={2}>
          <Heading size="sm">Steps</Heading>
          {feature.steps.length === 0 ? (
            <Text color="secondaryLight">No steps defined yet.</Text>
          ) : (
            <FlatList
              testID="feature-steps-list"
              data={feature.steps}
              renderItem={renderStep}
              keyExtractor={(item) => item._id}
              contentContainerStyle={{gap: 8}}
            />
          )}
        </Box>
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default FeatureDetailScreen;
