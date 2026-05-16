import {Box, Button, Card, Heading, Page, Text, TextField} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";
import {ScrollView} from "react-native";
import {type PreviewCardResponse, usePreviewCardMutation} from "@/store/sdk";

const EXAMPLE_PAYLOAD = JSON.stringify(
  {
    v: "1",
    fallbackText: "Delete branch feature/x? Reply yes or no.",
    cards: [
      {
        kind: "yes_no",
        question: "Delete branch feature/x?",
        actionId: "delete_branch",
      },
    ],
  },
  null,
  2
);

const AdminCardPreviewScreen: React.FC = () => {
  const [input, setInput] = useState(EXAMPLE_PAYLOAD);
  const [output, setOutput] = useState<PreviewCardResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewCard, {isLoading}] = usePreviewCardMutation();

  const handleRender = useCallback(async () => {
    setParseError(null);
    setOutput(null);
    let body: unknown;
    try {
      body = JSON.parse(input);
    } catch (err) {
      setParseError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    try {
      const result = await previewCard(body as never).unwrap();
      setOutput(result);
    } catch (err) {
      // RTK Query error shape: {status, data}
      const e = err as {status?: number; data?: PreviewCardResponse};
      if (e.data) {
        setOutput(e.data);
      } else {
        setParseError(`Request failed: ${JSON.stringify(err)}`);
      }
    }
  }, [input, previewCard]);

  return (
    <Page title="Card Preview">
      <Box testID="admin-card-preview-screen" gap={3} padding={3}>
        <Heading>Rich Response Card Preview</Heading>
        <Text size="sm" color="secondaryLight">
          Paste a RichResponse JSON payload below to validate it and render the resulting Slack
          Block Kit blocks. Admin-only.
        </Text>

        <Card>
          <Box padding={3} gap={2}>
            <Text>Input JSON</Text>
            <TextField
              testID="admin-card-preview-input"
              title="RichResponse JSON"
              value={input}
              onChange={setInput}
              placeholder="Paste a RichResponse JSON object..."
            />
            <Button
              testID="admin-card-preview-render-button"
              text={isLoading ? "Rendering…" : "Render"}
              onClick={handleRender}
              disabled={isLoading}
            />
          </Box>
        </Card>

        {parseError && (
          <Card>
            <Box padding={3}>
              <Text color="error">{parseError}</Text>
            </Box>
          </Card>
        )}

        {output?.validation && output.validation.length > 0 && (
          <Card>
            <Box padding={3} gap={1} testID="admin-card-preview-output-validation">
              <Text color="error">Validation errors:</Text>
              <ScrollView style={{maxHeight: 200}}>
                <Text>{JSON.stringify(output.validation, null, 2)}</Text>
              </ScrollView>
            </Box>
          </Card>
        )}

        {output?.slackBlocks && (
          <Card>
            <Box padding={3} gap={1} testID="admin-card-preview-output-slack">
              <Text>Slack blocks ({output.slackBlocks.length}):</Text>
              <ScrollView style={{maxHeight: 400}}>
                <Text>{JSON.stringify(output.slackBlocks, null, 2)}</Text>
              </ScrollView>
              {output.fallbackText && (
                <>
                  <Text>Fallback text:</Text>
                  <Text>{output.fallbackText}</Text>
                </>
              )}
            </Box>
          </Card>
        )}
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default AdminCardPreviewScreen;
