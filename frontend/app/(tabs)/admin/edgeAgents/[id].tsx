import {Badge, Box, Button, Card, Heading, Page, Spinner, Text, TextField} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {useCallback, useState} from "react";
import {FlatList, ScrollView} from "react-native";
import {
  type EdgeAgentEvent,
  useApproveEdgeAgentMutation,
  useGetEdgeAgentQuery,
  useListEdgeAgentEventsQuery,
  useRevokeEdgeAgentMutation,
  useSendEdgeAgentCommandMutation,
  useUpdateEdgeAgentMutation,
} from "@/store/sdk";

const statusMap: Record<string, "info" | "success" | "error" | "warning" | "neutral"> = {
  pending: "warning",
  approved: "info",
  online: "success",
  offline: "neutral",
  error: "error",
};

const EdgeAgentDetailScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const {data: agent, isLoading} = useGetEdgeAgentQuery(id!, {
    pollingInterval: 10000,
  });
  const {data: eventsData} = useListEdgeAgentEventsQuery({agentId: id!}, {pollingInterval: 15000});
  const [approve] = useApproveEdgeAgentMutation();
  const [revoke] = useRevokeEdgeAgentMutation();
  const [sendCommand] = useSendEdgeAgentCommandMutation();
  const [updateAgent] = useUpdateEdgeAgentMutation();

  const [configJson, setConfigJson] = useState("");
  const [configEditing, setConfigEditing] = useState(false);
  const [commandType, setCommandType] = useState("send_message");
  const [commandPayload, setCommandPayload] = useState('{"to": "", "text": ""}');

  const events = eventsData?.results || [];

  const handleApprove = useCallback(async () => {
    if (!id) {
      return;
    }
    await approve(id);
  }, [id, approve]);

  const handleRevoke = useCallback(async () => {
    if (!id) {
      return;
    }
    await revoke(id);
  }, [id, revoke]);

  const handleSaveConfig = useCallback(async () => {
    if (!id) {
      return;
    }
    try {
      const config = JSON.parse(configJson);
      await updateAgent({id, body: {config}});
      setConfigEditing(false);
    } catch (err) {
      alert(`Invalid JSON: ${err}`);
    }
  }, [id, configJson, updateAgent]);

  const handleSendCommand = useCallback(async () => {
    if (!id) {
      return;
    }
    try {
      const payload = JSON.parse(commandPayload);
      await sendCommand({id, type: commandType, payload});
      alert("Command queued");
    } catch (err) {
      alert(`Error: ${err}`);
    }
  }, [id, commandType, commandPayload, sendCommand]);

  if (isLoading || !agent) {
    return (
      <Page navigation={undefined} title="Edge Agent">
        <Box padding={4} alignItems="center" testID="edge-agent-detail-screen">
          <Spinner />
        </Box>
      </Page>
    );
  }

  const heartbeatAge = agent.lastHeartbeatAt
    ? Math.round((Date.now() - new Date(agent.lastHeartbeatAt).getTime()) / 1000)
    : null;

  return (
    <Page navigation={undefined} title={agent.name}>
      <ScrollView>
        <Box padding={4} gap={4} testID="edge-agent-detail-screen">
          {/* Header */}
          <Box direction="row" justifyContent="between" alignItems="center">
            <Heading>{agent.name}</Heading>
            <Badge
              testID="edge-agent-status-badge"
              status={statusMap[agent.status] || "neutral"}
              value={agent.status}
            />
          </Box>

          {/* Info */}
          <Card>
            <Box padding={3} gap={2}>
              <Heading size="sm">Details</Heading>
              <Text size="sm">Type: {agent.agentType}</Text>
              {agent.platform && (
                <Text size="sm">
                  Platform: {agent.platform}/{agent.arch}
                </Text>
              )}
              {agent.hostname && <Text size="sm">Hostname: {agent.hostname}</Text>}
              {agent.version && <Text size="sm">Version: {agent.version}</Text>}
              {heartbeatAge !== null && (
                <Text size="sm">
                  Last heartbeat:{" "}
                  {heartbeatAge < 60
                    ? `${heartbeatAge}s ago`
                    : `${Math.round(heartbeatAge / 60)}m ago`}
                </Text>
              )}
              {agent.approvedAt && (
                <Text size="sm">Approved: {new Date(agent.approvedAt).toLocaleString()}</Text>
              )}
              <Text size="sm">Capabilities: {agent.capabilities.join(", ") || "none"}</Text>
            </Box>
          </Card>

          {/* Actions */}
          <Card>
            <Box padding={3} gap={2}>
              <Heading size="sm">Actions</Heading>
              <Box direction="row" gap={2}>
                {agent.status === "pending" && (
                  <Button
                    testID="edge-agent-approve-button"
                    text="Approve"
                    onClick={handleApprove}
                  />
                )}
                {(agent.status === "approved" ||
                  agent.status === "online" ||
                  agent.status === "offline") && (
                  <Button
                    testID="edge-agent-revoke-button"
                    text="Revoke"
                    variant="outline"
                    onClick={handleRevoke}
                  />
                )}
              </Box>
            </Box>
          </Card>

          {/* Config Editor */}
          <Card>
            <Box padding={3} gap={2}>
              <Box direction="row" justifyContent="between" alignItems="center">
                <Heading size="sm">Config</Heading>
                {!configEditing ? (
                  <Button
                    testID="edge-agent-config-edit-button"
                    text="Edit"
                    onClick={() => {
                      setConfigJson(JSON.stringify(agent.config, null, 2));
                      setConfigEditing(true);
                    }}
                  />
                ) : (
                  <Box direction="row" gap={2}>
                    <Button
                      testID="edge-agent-config-save-button"
                      text="Save"
                      onClick={handleSaveConfig}
                    />
                    <Button
                      text="Cancel"
                      variant="outline"
                      onClick={() => setConfigEditing(false)}
                    />
                  </Box>
                )}
              </Box>
              {configEditing ? (
                <TextField
                  testID="edge-agent-config-input"
                  placeholder="Config JSON"
                  value={configJson}
                  onChange={setConfigJson}
                  rows={8}
                />
              ) : (
                <Text size="sm" testID="edge-agent-config-display">
                  {JSON.stringify(agent.config, null, 2)}
                </Text>
              )}
            </Box>
          </Card>

          {/* Command Sender */}
          <Card>
            <Box padding={3} gap={2}>
              <Heading size="sm">Send Command</Heading>
              <TextField
                testID="edge-agent-command-type-input"
                placeholder="Command Type"
                title="Command Type"
                value={commandType}
                onChange={setCommandType}
              />
              <TextField
                testID="edge-agent-command-payload-input"
                placeholder="Payload (JSON)"
                title="Payload (JSON)"
                value={commandPayload}
                onChange={setCommandPayload}
                rows={4}
              />
              <Button
                testID="edge-agent-send-command-button"
                text="Send Command"
                onClick={handleSendCommand}
              />
            </Box>
          </Card>

          {/* Command Results */}
          {agent.lastCommandResults.length > 0 && (
            <Card>
              <Box padding={3} gap={2}>
                <Heading size="sm">Last Command Results</Heading>
                {agent.lastCommandResults.map((result) => (
                  <Box key={result.commandId} direction="row" gap={2} alignItems="center">
                    <Badge
                      status={result.success ? "success" : "error"}
                      value={result.success ? "ok" : "fail"}
                    />
                    <Text size="sm">{result.commandId.slice(0, 8)}</Text>
                    {result.error && (
                      <Text size="sm" color="error">
                        {result.error}
                      </Text>
                    )}
                  </Box>
                ))}
              </Box>
            </Card>
          )}

          {/* Events Timeline */}
          <Card>
            <Box padding={3} gap={2}>
              <Heading size="sm">Events</Heading>
              {events.length === 0 ? (
                <Text color="secondaryLight" size="sm">
                  No events yet
                </Text>
              ) : (
                <FlatList
                  data={events}
                  keyExtractor={(item) => item._id}
                  scrollEnabled={false}
                  renderItem={({item}: {item: EdgeAgentEvent}) => (
                    <Box testID={`edge-agent-event-${item._id}`} padding={2} gap={1}>
                      <Box direction="row" justifyContent="between">
                        <Text size="sm">{item.eventType}</Text>
                        <Text size="sm" color="secondaryLight">
                          {new Date(item.created).toLocaleString()}
                        </Text>
                      </Box>
                      {Object.keys(item.payload).length > 0 && (
                        <Text size="sm" color="secondaryLight">
                          {JSON.stringify(item.payload)}
                        </Text>
                      )}
                    </Box>
                  )}
                />
              )}
            </Box>
          </Card>
        </Box>
      </ScrollView>
    </Page>
  );
};

// Expo Router requires default export for route files
export default EdgeAgentDetailScreen;
