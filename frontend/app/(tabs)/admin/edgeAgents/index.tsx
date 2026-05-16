import {Badge, Box, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {FlatList, Pressable} from "react-native";
import {type EdgeAgent, useListEdgeAgentsQuery} from "@/store/sdk";

const statusMap: Record<string, "info" | "success" | "error" | "warning" | "neutral"> = {
  pending: "warning",
  approved: "info",
  online: "success",
  offline: "neutral",
  error: "error",
};

const EdgeAgentListScreen: React.FC = () => {
  const router = useRouter();
  const {data, isLoading} = useListEdgeAgentsQuery();

  const agents = data?.results || [];

  const handlePress = useCallback(
    (agent: EdgeAgent) => {
      router.push(`/admin/edgeAgents/${agent._id}` as any);
    },
    [router]
  );

  const renderAgent = useCallback(
    ({item}: {item: EdgeAgent}) => {
      const heartbeatAge = item.lastHeartbeatAt
        ? Math.round((Date.now() - new Date(item.lastHeartbeatAt).getTime()) / 1000)
        : null;

      return (
        <Pressable onPress={() => handlePress(item)} testID={`edge-agents-item-${item._id}`}>
          <Card>
            <Box padding={3} gap={2}>
              <Box direction="row" justifyContent="between" alignItems="center">
                <Heading size="sm">{item.name}</Heading>
                <Badge
                  testID={`edge-agent-status-badge-${item._id}`}
                  status={statusMap[item.status] || "neutral"}
                  value={item.status}
                />
              </Box>
              <Box direction="row" gap={4}>
                <Text color="secondaryLight" size="sm">
                  {item.agentType}
                </Text>
                {item.platform && (
                  <Text color="secondaryLight" size="sm">
                    {item.platform}/{item.arch}
                  </Text>
                )}
                {item.hostname && (
                  <Text color="secondaryLight" size="sm">
                    {item.hostname}
                  </Text>
                )}
              </Box>
              {heartbeatAge !== null && (
                <Text color="secondaryLight" size="sm">
                  Last heartbeat:{" "}
                  {heartbeatAge < 60
                    ? `${heartbeatAge}s ago`
                    : `${Math.round(heartbeatAge / 60)}m ago`}
                </Text>
              )}
              {item.pendingCommands.length > 0 && (
                <Text color="secondaryLight" size="sm">
                  {item.pendingCommands.length} pending command(s)
                </Text>
              )}
            </Box>
          </Card>
        </Pressable>
      );
    },
    [handlePress]
  );

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Edge Agents">
        <Box padding={4} alignItems="center" testID="edge-agents-list">
          <Spinner />
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="Edge Agents">
      <Box padding={4} gap={4} testID="edge-agents-list">
        <Heading>Edge Agents</Heading>

        {agents.length === 0 ? (
          <Box padding={8} alignItems="center">
            <Text color="secondaryLight">No edge agents registered yet.</Text>
          </Box>
        ) : (
          <FlatList
            data={agents}
            renderItem={renderAgent}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{gap: 12}}
          />
        )}
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default EdgeAgentListScreen;
