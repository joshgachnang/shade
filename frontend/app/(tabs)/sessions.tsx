import {Badge, Box, Button, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useMemo} from "react";
import {FlatList} from "react-native";
import {
  useListZergSessionsQuery,
  type ZergActivity,
  type ZergDashboard,
  type ZergInboxItem,
  type ZergSessionRow,
} from "@/store/sdk";

// Poll while the screen is mounted; the backend caches for 5 s, so this costs
// one `zerg dash` per 15 s at most across every viewer.
const POLL_INTERVAL_MS = 15000;

type BadgeStatus = "error" | "warning" | "info" | "success" | "neutral";

const ACTIVITY_BADGE: Record<ZergActivity, BadgeStatus> = {
  blocked: "error",
  dead: "error",
  idle: "warning",
  working: "success",
  error: "error",
  exited: "neutral",
  unknown: "neutral",
};

const formatAge = (seconds?: number): string => {
  if (seconds === undefined) {
    return "";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }
  return `${Math.floor(seconds / 86400)}d`;
};

const formatSummary = (dashboard: ZergDashboard): string => {
  const {running, cap, needsYou, inboxPending} = dashboard.summary;
  const parts = [`${running} running${cap !== undefined ? ` of ${cap}` : ""}`];
  parts.push(`${needsYou} need${needsYou === 1 ? "s" : ""} you`);
  if (inboxPending > 0) {
    parts.push(`${inboxPending} inbox pending`);
  }
  return parts.join(" · ");
};

const formatFetchedAt = (iso: string): string => {
  const fetched = DateTime.fromISO(iso);
  return fetched.isValid ? fetched.toFormat("h:mm:ss a") : "";
};

const SessionRowCard: React.FC<{row: ZergSessionRow}> = ({row}) => {
  const age = formatAge(row.activityAgeSeconds);
  const detail = row.blockedOn ?? row.needsYouWhy;
  return (
    <Card testID={`sessions-item-${row.session}`}>
      <Box padding={3} gap={1}>
        <Box direction="row" justifyContent="between" alignItems="center" gap={2}>
          <Text bold testID={`sessions-item-${row.session}-name`}>
            {row.tmux}
          </Text>
          <Box direction="row" gap={1} alignItems="center">
            {row.needsYou ? <Badge status="error" value="needs you" /> : null}
            <Badge
              status={ACTIVITY_BADGE[row.activity]}
              value={age ? `${row.activity} · ${age}` : row.activity}
              testID={`sessions-item-${row.session}-activity`}
            />
          </Box>
        </Box>
        <Box direction="row" gap={2} wrap>
          <Text color="secondaryLight" size="sm" testID={`sessions-item-${row.session}-stage`}>
            stage: {row.stage}
          </Text>
          {row.pr ? (
            <Text color="secondaryLight" size="sm" testID={`sessions-item-${row.session}-pr`}>
              PR: {row.pr}
            </Text>
          ) : null}
          {row.agent ? (
            <Text color="secondaryLight" size="sm">
              agent: {row.agent}
            </Text>
          ) : null}
          {row.verdict ? (
            <Text color="secondaryLight" size="sm">
              verdict: {row.verdict}
            </Text>
          ) : null}
        </Box>
        {detail ? (
          <Text size="sm" testID={`sessions-item-${row.session}-blocked`}>
            {detail}
          </Text>
        ) : null}
        {row.lastLine ? (
          <Text color="secondaryLight" size="sm" testID={`sessions-item-${row.session}-last`}>
            {row.lastLine}
          </Text>
        ) : null}
        <Text color="secondaryLight" size="sm" testID={`sessions-item-${row.session}-attach`}>
          {row.attachCommand}
          {row.claudeSessionId ? ` → claude --resume ${row.claudeSessionId}` : ""}
        </Text>
      </Box>
    </Card>
  );
};

const InboxItemCard: React.FC<{item: ZergInboxItem; index: number}> = ({item, index}) => (
  <Card testID={`sessions-inbox-item-${index}`}>
    <Box padding={3} gap={1}>
      <Box direction="row" justifyContent="between" alignItems="center" gap={2}>
        <Text bold>{item.question ?? "(no question text)"}</Text>
        {item.kind ? <Badge status="warning" value={item.kind} /> : null}
      </Box>
      {item.session ? (
        <Text color="secondaryLight" size="sm">
          {item.session}
        </Text>
      ) : null}
      {item.recommendation ? <Text size="sm">Recommendation: {item.recommendation}</Text> : null}
      {item.options && item.options.length > 0 ? (
        <Text color="secondaryLight" size="sm">
          Options: {item.options.join(" / ")}
        </Text>
      ) : null}
      <Text color="secondaryLight" size="sm">
        Answer in zerg: `zerg answer` / `zerg approve`
      </Text>
    </Box>
  </Card>
);

const SessionsScreen: React.FC = () => {
  const {data, isLoading, isFetching, refetch} = useListZergSessionsQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const inbox = useMemo(() => data?.inbox ?? [], [data]);

  const handleRefresh = useCallback((): void => {
    refetch();
  }, [refetch]);

  const renderRow = useCallback(
    ({item}: {item: ZergSessionRow}) => <SessionRowCard row={item} />,
    []
  );

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Sessions">
        <Box padding={4} alignItems="center" testID="sessions-screen">
          <Box testID="sessions-loading">
            <Spinner />
          </Box>
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="Sessions">
      <Box padding={4} gap={4} testID="sessions-screen">
        <Box direction="row" justifyContent="between" alignItems="center" gap={2}>
          <Box gap={1}>
            <Heading>Sessions</Heading>
            {data ? (
              <Text color="secondaryLight" size="sm" testID="sessions-summary">
                {formatSummary(data)}
                {data.fetchedAt ? ` · as of ${formatFetchedAt(data.fetchedAt)}` : ""}
              </Text>
            ) : null}
          </Box>
          <Button
            testID="sessions-refresh-button"
            text={isFetching ? "Refreshing..." : "Refresh"}
            variant="outline"
            onClick={handleRefresh}
          />
        </Box>

        {data?.error ? (
          <Box testID="sessions-error-banner" padding={3} border="error" rounding="md" gap={1}>
            <Text bold>zerg unreachable</Text>
            <Text size="sm">{data.error}</Text>
            {data.source === "cache" ? (
              <Text color="secondaryLight" size="sm">
                Showing the last known state.
              </Text>
            ) : null}
          </Box>
        ) : null}

        {rows.length === 0 ? (
          <Box testID="sessions-empty-state" padding={8} alignItems="center">
            <Text color="secondaryLight">No zerg sessions.</Text>
          </Box>
        ) : (
          <FlatList
            testID="sessions-list"
            data={rows}
            keyExtractor={(row) => row.session}
            renderItem={renderRow}
            ItemSeparatorComponent={() => <Box height={8} />}
            scrollEnabled={false}
          />
        )}

        {inbox.length > 0 ? (
          <Box gap={2} testID="sessions-inbox">
            <Heading size="sm">Inbox — decisions waiting on you</Heading>
            {inbox.map((item, index) => (
              <InboxItemCard
                key={item.id ?? `${item.session ?? ""}-${index}`}
                item={item}
                index={index}
              />
            ))}
          </Box>
        ) : null}
      </Box>
    </Page>
  );
};

// Expo Router requires default export for route files
export default SessionsScreen;
