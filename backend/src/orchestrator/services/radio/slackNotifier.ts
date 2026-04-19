/**
 * Posts radio-transcription messages to Slack either via the Web API
 * (bot token + channel ID) or an incoming webhook URL. When a recording URL is
 * supplied, both variants render a Block Kit "Listen" button below the text.
 */

interface SlackBlockButtonPayload {
  blocks: Array<{
    type: "section";
    text: {type: "mrkdwn"; text: string};
    accessory: {
      type: "button";
      text: {type: "plain_text"; text: string};
      url: string;
      action_id: string;
    };
  }>;
}

const buildListenBlocks = (text: string, recordingUrl: string): SlackBlockButtonPayload => ({
  blocks: [
    {
      type: "section",
      text: {type: "mrkdwn", text},
      accessory: {
        type: "button",
        text: {type: "plain_text", text: "Listen"},
        url: recordingUrl,
        action_id: "listen_recording",
      },
    },
  ],
});

export const postMessageToSlack = async (args: {
  botToken: string;
  channelId: string;
  text: string;
  recordingUrl?: string;
}): Promise<void> => {
  const {botToken, channelId, text, recordingUrl} = args;
  const body: Record<string, unknown> = {channel: channelId, text};
  if (recordingUrl) {
    Object.assign(body, buildListenBlocks(text, recordingUrl));
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as {ok?: boolean; error?: string};
  if (!data.ok) {
    throw new Error(`chat.postMessage failed: ${data.error}`);
  }
};

export const sendToSlackWebhook = async (args: {
  webhookUrl: string;
  text: string;
  recordingUrl?: string;
}): Promise<void> => {
  const {webhookUrl, text, recordingUrl} = args;
  const body: SlackBlockButtonPayload | {text: string} = recordingUrl
    ? buildListenBlocks(text, recordingUrl)
    : {text};

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook returned ${response.status}: ${await response.text()}`);
  }
};
