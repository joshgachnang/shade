import {Badge, Box, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {Image, ScrollView} from "react-native";
import {useGetFrameAnalysisQuery, useGetFrameQuery} from "@/store/sdk";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4020";

const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const FrameDetailScreen: React.FC = () => {
  const {id, frameId} = useLocalSearchParams<{id: string; frameId: string}>();
  const {data: frame, isLoading: frameLoading} = useGetFrameQuery(frameId);
  const {data: analysisData, isLoading: analysisLoading} = useGetFrameAnalysisQuery({frameId});

  const analysis = analysisData?.results?.[0];
  const isLoading = frameLoading || analysisLoading;

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Frame">
        <Box padding={4} alignItems="center" testID="frame-detail-screen">
          <Spinner testID="frame-detail-loading-spinner" />
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title={`Frame ${frame?.frameNumber ?? ""}`}>
      <ScrollView>
        <Box padding={4} gap={4} testID="frame-detail-screen">
          {/* Frame Image */}
          {frame && (
            <Box>
              <Image
                testID="frame-detail-image"
                source={{
                  uri: `${API_URL}/static/movies/${id}/frames/frame_${String((frame.frameNumber || 0) + 1).padStart(6, "0")}.jpg`,
                }}
                style={{width: "100%", aspectRatio: 16 / 9, borderRadius: 8}}
                resizeMode="contain"
              />
              <Text testID="frame-detail-timestamp" size="sm" color="secondaryLight" marginTop={1}>
                {formatTimestamp(frame.timestamp)}
              </Text>
            </Box>
          )}

          {analysis && (
            <>
              {/* Scene Description */}
              <Card>
                <Box padding={3} gap={2}>
                  <Heading size="sm">Scene</Heading>
                  <Text testID="frame-detail-scene-description">{analysis.sceneDescription}</Text>
                  {analysis.mood && (
                    <Box flexDirection="row" alignItems="center" gap={2}>
                      <Text size="sm" bold>
                        Mood:
                      </Text>
                      <Text testID="frame-detail-mood" size="sm">
                        {analysis.mood}
                      </Text>
                    </Box>
                  )}
                </Box>
              </Card>

              {/* Objects */}
              {analysis.objects.length > 0 && (
                <Card>
                  <Box padding={3} gap={2}>
                    <Heading size="sm">Objects</Heading>
                    <Box
                      testID="frame-detail-objects-list"
                      flexDirection="row"
                      flexWrap="wrap"
                      gap={2}
                    >
                      {analysis.objects.map((obj, i) => (
                        <Badge
                          key={`obj-${obj.label}-${i}`}
                          testID={`frame-detail-object-${i}`}
                          text={`${obj.label} (${Math.round(obj.confidence * 100)}%)`}
                          color="blue"
                        />
                      ))}
                    </Box>
                  </Box>
                </Card>
              )}

              {/* Characters */}
              {analysis.characters.length > 0 && (
                <Card>
                  <Box padding={3} gap={2}>
                    <Heading size="sm">Characters</Heading>
                    <Box testID="frame-detail-characters-list" gap={2}>
                      {analysis.characters.map((char, i) => (
                        <Box
                          key={`char-${char.name}-${i}`}
                          testID={`frame-detail-character-${i}`}
                          gap={1}
                        >
                          <Box flexDirection="row" justifyContent="space-between">
                            <Text bold>{char.name}</Text>
                            <Text size="xs" color="secondaryLight">
                              {Math.round(char.confidence * 100)}%
                            </Text>
                          </Box>
                          <Text size="sm" color="secondaryLight">
                            {char.description}
                          </Text>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Card>
              )}

              {/* Text / OCR */}
              {analysis.text.length > 0 && (
                <Card>
                  <Box padding={3} gap={2}>
                    <Heading size="sm">Text</Heading>
                    <Box testID="frame-detail-text-list" gap={2}>
                      {analysis.text.map((t, i) => (
                        <Box key={`text-${i}`} testID={`frame-detail-text-${i}`} gap={1}>
                          <Text>{t.content}</Text>
                          <Text size="xs" color="secondaryLight">
                            Source: {t.context}
                          </Text>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Card>
              )}

              {/* Tags */}
              {analysis.tags.length > 0 && (
                <Card>
                  <Box padding={3} gap={2}>
                    <Heading size="sm">Tags</Heading>
                    <Box
                      testID="frame-detail-tags-list"
                      flexDirection="row"
                      flexWrap="wrap"
                      gap={2}
                    >
                      {analysis.tags.map((tag, i) => (
                        <Badge
                          key={`tag-${tag}-${i}`}
                          testID={`frame-detail-tag-${i}`}
                          text={tag}
                          color="gray"
                        />
                      ))}
                    </Box>
                  </Box>
                </Card>
              )}
            </>
          )}
        </Box>
      </ScrollView>
    </Page>
  );
};

// Expo Router requires default export for route files
export default FrameDetailScreen;
